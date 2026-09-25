"""PLS-MGA (Multi-Group Analysis): compares structural path coefficients
between two groups of respondents using three complementary significance
tests, following Sarstedt, Henseler & Ringle (2011) "Multigroup analysis in
partial least squares (PLS) path modeling: Alternative methods and
empirical results":

  - Parametric test (Chin, 2000): a pooled-variance t-test built from each
    group's bootstrap standard error of the path coefficient.
  - Welch-Satterthwaite test (Keil et al., 2000): the same idea without the
    equal-variance assumption -- generally the more defensible of the two
    parametric options.
  - Permutation test (Chin & Dibbern, 2010): non-parametric. Refits PLS on
    many random re-splits of the POOLED sample into two groups of the
    original sizes (no distributional assumption at all), building a null
    distribution of each path's group difference.
  - PLS-MGA (Henseler, Ringle & Sinkovics, 2009): non-parametric. Compares
    each group's own bootstrap distribution of a path coefficient directly
    (paired by resample index) instead of first reducing each group's
    bootstrap results to a single standard error.

Deliberately restricted to models WITHOUT interaction/moderation
constructs -- MGA and moderation are each already substantial on their
own, and combining them (a group-specific product term / two-stage refit
per resample, per group) is out of scope here. routes/mga_api.py rejects
such models up front with a clear message rather than silently producing
something only partially correct.

Mirrors pls/bootstrap.py's approach (NumPy end-to-end, "individual sign
change" correction against a fixed reference sample's outer weights) but
tracks ONLY path coefficients -- MGA needs no loadings/weights/indirect-
effect resampling.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy import stats

from i18n import DEFAULT_LANG, t

from .algorithm import PLSResult, _build_topology, _fit, _ols_beta, _standardize_cols, run_pls_algorithm
from .model import Model

MIN_BOOT_SAMPLES = 100
MAX_BOOT_SAMPLES = 5000
MIN_PERMUTATIONS = 100
MAX_PERMUTATIONS = 5000

# Below this many observations, a group's own bootstrap/permutation refits
# are too unstable to trust -- same floor run_pls_algorithm effectively
# requires (len(indicators) + 5) but stated here explicitly since MGA fails
# per-GROUP, not on the whole sample.
MIN_GROUP_OBS = 30


def _path_pairs(model: Model) -> list[tuple[str, str]]:
    return [(src, tgt) for tgt in model.constructs for src in model.predecessors(tgt)]


def _group_bootstrap_paths(
    model: Model, original: PLSResult, n_boot: int, seed: int | None, max_iterations: int = 300,
) -> dict[tuple[str, str], np.ndarray]:
    """Bootstraps ONE group's own data (resampling with replacement from
    `original.data`), returning {(src,tgt): array of that path's coefficient
    across valid resamples}. Same resampling + "individual sign change"
    correction as bootstrap.run_bootstrap, trimmed to skip the loadings/
    weights/indirect-effect bookkeeping this feature doesn't need.
    """
    indicators = model.all_indicators()
    topo = _build_topology(model, indicators)
    raw = original.data[indicators].values
    n_obs = raw.shape[0]
    k = len(topo.construct_ids)
    orig_w = original.outer_weights[indicators].values

    endogenous = [ci for ci in range(k) if topo.pred_pos[ci]]
    pairs = [
        (topo.construct_ids[pj], topo.construct_ids[ci])
        for ci in endogenous for pj in topo.pred_pos[ci]
    ]
    path_values: dict[tuple[str, str], list[float]] = {pair: [] for pair in pairs}

    rng = np.random.default_rng(seed)
    for _ in range(n_boot):
        idx = rng.integers(0, n_obs, size=n_obs)
        X = _standardize_cols(raw[idx])
        try:
            w, Y, _n_iter, converged = _fit(X, topo, max_iterations, 1e-7)
        except np.linalg.LinAlgError:
            continue
        if not converged:
            continue

        block_sign = np.empty(k)
        for ci in range(k):
            bi = topo.block_idx[ci]
            dot = float(np.dot(orig_w[bi], w[bi]))
            block_sign[ci] = 1.0 if dot >= 0 else -1.0

        for ci in endogenous:
            preds = topo.pred_pos[ci]
            beta = _ols_beta(Y[:, preds], Y[:, ci])[:-1]
            tgt_id = topo.construct_ids[ci]
            for pi, src_pos in enumerate(preds):
                src_id = topo.construct_ids[src_pos]
                s = block_sign[src_pos] * block_sign[ci]
                path_values[(src_id, tgt_id)].append(s * float(beta[pi]))

    return {pair: np.asarray(vals, dtype=float) for pair, vals in path_values.items()}


def _permutation_diffs(
    model: Model, data_a: pd.DataFrame, data_b: pd.DataFrame, orig_w_ref: np.ndarray,
    path_pairs: list[tuple[str, str]], n_perm: int, seed: int | None, max_iterations: int = 300,
) -> dict[tuple[str, str], np.ndarray]:
    """Refits PLS on many random re-splits of the pooled (data_a + data_b)
    sample into two pseudo-groups of the ORIGINAL sizes, drawn WITHOUT
    replacement (what makes this a permutation test rather than a second
    bootstrap) -- returns {(src,tgt): array of GROUP_A-GROUP_B coefficient
    differences} under the null hypothesis of no group effect.

    Every pseudo-group fit is sign-corrected against `orig_w_ref` (the
    ACTUAL original sample's outer weights, from the true group split) --
    a fixed reference, since a permutation replicate has no "self"
    reference the way a bootstrap resample of the same group does.
    """
    indicators = model.all_indicators()
    topo = _build_topology(model, indicators)
    pooled = pd.concat([data_a[indicators], data_b[indicators]], axis=0).values
    n1, n2 = len(data_a), len(data_b)
    n_total = n1 + n2
    k = len(topo.construct_ids)
    endogenous = [ci for ci in range(k) if topo.pred_pos[ci]]

    diff_values: dict[tuple[str, str], list[float]] = {pair: [] for pair in path_pairs}
    rng = np.random.default_rng(seed)

    def fit_group(rows: np.ndarray) -> dict[tuple[str, str], float] | None:
        X = _standardize_cols(rows)
        try:
            w, Y, _n_iter, converged = _fit(X, topo, max_iterations, 1e-7)
        except np.linalg.LinAlgError:
            return None
        if not converged:
            return None
        block_sign = np.empty(k)
        for ci in range(k):
            bi = topo.block_idx[ci]
            dot = float(np.dot(orig_w_ref[bi], w[bi]))
            block_sign[ci] = 1.0 if dot >= 0 else -1.0
        out: dict[tuple[str, str], float] = {}
        for ci in endogenous:
            preds = topo.pred_pos[ci]
            beta = _ols_beta(Y[:, preds], Y[:, ci])[:-1]
            tgt_id = topo.construct_ids[ci]
            for pi, src_pos in enumerate(preds):
                src_id = topo.construct_ids[src_pos]
                s = block_sign[src_pos] * block_sign[ci]
                out[(src_id, tgt_id)] = s * float(beta[pi])
        return out

    for _ in range(n_perm):
        perm = rng.permutation(n_total)
        coef_a = fit_group(pooled[perm[:n1]])
        coef_b = fit_group(pooled[perm[n1:]])
        if coef_a is None or coef_b is None:
            continue
        for pair in path_pairs:
            diff_values[pair].append(coef_a[pair] - coef_b[pair])

    return {pair: np.asarray(vals, dtype=float) for pair, vals in diff_values.items()}


@dataclass
class MgaGroupInfo:
    label: str
    n_obs: int
    path_coefficients: dict[tuple[str, str], float]
    r_squared: dict[str, float]


@dataclass
class MgaPathResult:
    source: str
    target: str
    coef_a: float
    coef_b: float
    diff: float
    se_a: float | None
    se_b: float | None
    t_parametric: float | None
    p_parametric: float | None
    t_welch: float | None
    p_welch: float | None
    df_welch: float | None
    p_permutation: float | None
    p_mga: float | None
    significant_mga: bool | None


@dataclass
class MgaResult:
    group_a: MgaGroupInfo
    group_b: MgaGroupInfo
    paths: list[MgaPathResult] = field(default_factory=list)
    n_boot: int = 0
    n_perm: int = 0


def run_mga(
    model: Model,
    df_a: pd.DataFrame,
    df_b: pd.DataFrame,
    label_a: str,
    label_b: str,
    n_boot: int = 500,
    n_perm: int = 1000,
    seed: int | None = None,
    lang: str = DEFAULT_LANG,
) -> MgaResult:
    if model.has_interactions():
        raise ValueError(t("err_mga_no_interactions", lang))

    n_boot = max(MIN_BOOT_SAMPLES, min(MAX_BOOT_SAMPLES, int(n_boot)))
    n_perm = max(MIN_PERMUTATIONS, min(MAX_PERMUTATIONS, int(n_perm)))

    if len(df_a) < MIN_GROUP_OBS or len(df_b) < MIN_GROUP_OBS:
        raise ValueError(t("err_mga_group_too_small", lang, min=MIN_GROUP_OBS))

    orig_a = run_pls_algorithm(model, df_a, lang=lang)
    orig_b = run_pls_algorithm(model, df_b, lang=lang)

    pairs = _path_pairs(model)
    indicators = model.all_indicators()

    boot_a = _group_bootstrap_paths(model, orig_a, n_boot, seed)
    boot_b = _group_bootstrap_paths(model, orig_b, n_boot, None if seed is None else seed + 1)
    perm_diffs = _permutation_diffs(
        model, orig_a.data, orig_b.data, orig_a.outer_weights[indicators].values,
        pairs, n_perm, None if seed is None else seed + 2,
    )

    n1, n2 = len(orig_a.data), len(orig_b.data)
    path_results: list[MgaPathResult] = []
    for (src, tgt) in pairs:
        b1 = float(orig_a.path_coefficients.loc[src, tgt])
        b2 = float(orig_b.path_coefficients.loc[src, tgt])
        diff = b1 - b2

        boot1 = boot_a.get((src, tgt), np.array([]))
        boot2 = boot_b.get((src, tgt), np.array([]))
        se1 = float(boot1.std(ddof=1)) if boot1.size >= 2 else None
        se2 = float(boot2.std(ddof=1)) if boot2.size >= 2 else None

        # Parametric test (Chin 2000): pooled-variance t-test.
        t_par, p_par = None, None
        if se1 is not None and se2 is not None and n1 > 1 and n2 > 1:
            pooled_var = (((n1 - 1) ** 2) / (n1 + n2 - 2)) * se1 ** 2 + (((n2 - 1) ** 2) / (n1 + n2 - 2)) * se2 ** 2
            denom = float(np.sqrt(pooled_var)) * float(np.sqrt(1 / n1 + 1 / n2))
            if denom > 0:
                t_par = diff / denom
                p_par = float(2 * stats.t.sf(abs(t_par), n1 + n2 - 2))

        # Welch-Satterthwaite test (Keil et al. 2000): no equal-variance
        # assumption. se1/se2 are ALREADY standard errors of the path
        # coefficient (from each group's own bootstrap distribution), not
        # raw per-observation standard deviations -- so, unlike a textbook
        # two-sample t-test starting from raw data, there is no further
        # "/n" here (that would double-count the sample-size adjustment
        # already baked into a bootstrap SE).
        t_welch, p_welch, df_welch = None, None, None
        if se1 is not None and se2 is not None:
            v1, v2 = se1 ** 2, se2 ** 2
            denom = float(np.sqrt(v1 + v2))
            if denom > 0 and (v1 ** 2 / (n1 - 1) + v2 ** 2 / (n2 - 1)) > 0:
                t_welch = diff / denom
                df_welch = (v1 + v2) ** 2 / (v1 ** 2 / (n1 - 1) + v2 ** 2 / (n2 - 1))
                p_welch = float(2 * stats.t.sf(abs(t_welch), df_welch))

        # Permutation test (Chin & Dibbern 2010): exact-test style p-value,
        # +1 continuity correction so a path is never reported as p=0.
        p_perm = None
        diffs = perm_diffs.get((src, tgt), np.array([]))
        if diffs.size > 0:
            p_perm = float((int(np.sum(np.abs(diffs) >= abs(diff))) + 1) / (diffs.size + 1))

        # PLS-MGA (Henseler et al. 2009): pairs the two groups' bootstrap
        # distributions by resample index; significant at the 5% level iff
        # p < .05 or p > .95 (SmartPLS' own convention -- this asymmetric
        # threshold, not p < .025, is what "5%" means for this specific test).
        p_mga, sig_mga = None, None
        if boot1.size > 0 and boot2.size > 0:
            r = min(boot1.size, boot2.size)
            p_mga = float(np.mean(boot1[:r] > boot2[:r]))
            sig_mga = bool(p_mga < 0.05 or p_mga > 0.95)

        path_results.append(MgaPathResult(
            source=src, target=tgt, coef_a=b1, coef_b=b2, diff=diff,
            se_a=se1, se_b=se2,
            t_parametric=t_par, p_parametric=p_par,
            t_welch=t_welch, p_welch=p_welch, df_welch=df_welch,
            p_permutation=p_perm,
            p_mga=p_mga, significant_mga=sig_mga,
        ))

    group_a = MgaGroupInfo(
        label=label_a, n_obs=n1,
        path_coefficients={p: float(orig_a.path_coefficients.loc[p]) for p in pairs},
        r_squared={cid: float(v) for cid, v in orig_a.r_squared.items()},
    )
    group_b = MgaGroupInfo(
        label=label_b, n_obs=n2,
        path_coefficients={p: float(orig_b.path_coefficients.loc[p]) for p in pairs},
        r_squared={cid: float(v) for cid, v in orig_b.r_squared.items()},
    )
    return MgaResult(group_a=group_a, group_b=group_b, paths=path_results, n_boot=n_boot, n_perm=n_perm)
