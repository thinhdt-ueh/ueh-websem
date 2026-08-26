"""Bootstrapping for significance testing of PLS-SEM estimates (path coefficients,
outer loadings, outer weights) — mirrors SmartPLS' "Bootstrapping" report
(Original Sample, Sample Mean, STDEV, T Statistics, P Values) plus percentile
95% confidence intervals.

PLS solutions are not sign-identified: a bootstrap resample may converge to a
construct score with flipped sign relative to the original sample (this shows
up as e.g. all loadings/weights of a block flipping sign together). Before
accumulating statistics we align each bootstrap replicate's sign per construct
to the original sample ("individual sign change" correction), otherwise
coefficient distributions become spuriously bimodal and standard errors are
overstated.

Each replicate re-runs the full PLS algorithm, so this loop is the
performance-critical path (hundreds to thousands of reruns per analysis). It
therefore works directly on NumPy arrays end to end — building pandas
Series/DataFrames per replicate (as the single-shot `run_pls_algorithm` does
for convenience) would dominate runtime at this data size.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import stats

from .algorithm import PLSResult, _build_topology, _fit, _ols_beta, _standardize_cols
from .effects import enumerate_indirect_routes, find_moderated_mediation_opportunities
from .model import Model
from .moderation import _generate_indicator_based_interactions

MAX_BOOTSTRAP_SAMPLES = 5000
MIN_BOOTSTRAP_SAMPLES = 100


@dataclass
class BootstrapResult:
    n_requested: int
    n_valid: int
    path_stats: list[dict] = field(default_factory=list)
    loading_stats: list[dict] = field(default_factory=list)
    weight_stats: list[dict] = field(default_factory=list)
    specific_indirect_stats: list[dict] = field(default_factory=list)
    moderated_mediation_stats: list[dict] = field(default_factory=list)


HISTOGRAM_BINS = 22


def _summarize(values: list[float], original_value: float, include_histogram: bool = False) -> dict:
    arr = np.asarray(values, dtype=float)
    n = arr.size
    if n < 2:
        out = {
            "original": original_value, "mean": None, "std": None,
            "t_stat": None, "p_value": None, "ci_lower": None, "ci_upper": None,
        }
        if include_histogram:
            out["histogram"] = None
        return out
    mean = float(arr.mean())
    std = float(arr.std(ddof=1))
    if std > 0:
        t_stat = abs(original_value) / std
        p_value = float(2 * stats.t.sf(t_stat, n - 1))
    else:
        t_stat, p_value = None, None
    ci_lower, ci_upper = (float(v) for v in np.percentile(arr, [2.5, 97.5]))
    out = {
        "original": original_value, "mean": mean, "std": std,
        "t_stat": t_stat, "p_value": p_value, "ci_lower": ci_lower, "ci_upper": ci_upper,
    }
    if include_histogram:
        # Sent to the frontend to draw a small bootstrap-distribution chart
        # per path — binned server-side (rather than shipping all `n` raw
        # resample values) to keep the /api/analyze payload small regardless
        # of how many thousand bootstrap samples were requested.
        counts, edges = np.histogram(arr, bins=HISTOGRAM_BINS)
        out["histogram"] = {"edges": [float(e) for e in edges], "counts": [int(c) for c in counts]}
    return out


def run_bootstrap(
    model: Model,
    original: PLSResult,
    n_boot: int = 500,
    seed: int | None = None,
    max_iterations: int = 300,
) -> BootstrapResult:
    n_boot = max(MIN_BOOTSTRAP_SAMPLES, min(MAX_BOOTSTRAP_SAMPLES, int(n_boot)))
    rng = np.random.default_rng(seed)

    indicators = model.all_indicators()
    topo = _build_topology(model, indicators)
    raw = original.data[indicators].values  # (n, p), already cleaned/numeric
    n_obs, p = raw.shape
    k = len(topo.construct_ids)

    orig_w = original.outer_weights[indicators].values  # (p,) same column order as `raw`

    endogenous = [ci for ci in range(k) if topo.pred_pos[ci]]
    path_pairs = [
        (topo.construct_ids[pj], topo.construct_ids[ci])
        for ci in endogenous
        for pj in topo.pred_pos[ci]
    ]

    path_values: dict[tuple[str, str], list[float]] = {pair: [] for pair in path_pairs}
    loading_values: dict[str, list[float]] = {ind: [] for ind in indicators}
    weight_values: dict[str, list[float]] = {ind: [] for ind in indicators}

    # Specific indirect effects: for each mediated route, the per-resample
    # product of that route's already sign-corrected edge coefficients (not
    # the product of the *marginal* bootstrap distributions of each edge,
    # which would ignore the within-resample correlation between them).
    routes = enumerate_indirect_routes(model)
    route_values: dict[tuple[str, ...], list[float]] = {tuple(r): [] for r in routes}

    mm_opportunities = find_moderated_mediation_opportunities(model)
    mm_values: list[list[float]] = [[] for _ in mm_opportunities]

    n_valid = 0
    for _ in range(n_boot):
        idx = rng.integers(0, n_obs, size=n_obs)
        X = _standardize_cols(raw[idx])
        try:
            w, Y, _n_iter, converged = _fit(X, topo, max_iterations, 1e-7)
        except np.linalg.LinAlgError:
            continue
        if not converged:
            continue
        n_valid += 1

        # sign alignment per construct block, against the original sample's weights
        block_sign = np.empty(k)
        for ci in range(k):
            bi = topo.block_idx[ci]
            dot = float(np.dot(orig_w[bi], w[bi]))
            block_sign[ci] = 1.0 if dot >= 0 else -1.0

        iter_coef: dict[tuple[str, str], float] = {}
        for ci in endogenous:
            preds = topo.pred_pos[ci]
            beta = _ols_beta(Y[:, preds], Y[:, ci])[:-1]
            tgt_id = topo.construct_ids[ci]
            for pi, src_pos in enumerate(preds):
                src_id = topo.construct_ids[src_pos]
                s = block_sign[src_pos] * block_sign[ci]
                signed_beta = s * float(beta[pi])
                path_values[(src_id, tgt_id)].append(signed_beta)
                iter_coef[(src_id, tgt_id)] = signed_beta

        for route in routes:
            prod = 1.0
            for a, b in zip(route, route[1:]):
                prod *= iter_coef[(a, b)]
            route_values[tuple(route)].append(prod)

        for mi, opp in enumerate(mm_opportunities):
            index = 1.0
            for i, (a, b) in enumerate(zip(opp.route, opp.route[1:])):
                index *= iter_coef[(opp.interaction_id, b)] if i == opp.moderated_index else iter_coef[(a, b)]
            mm_values[mi].append(index)

        for ci in range(k):
            bi = topo.block_idx[ci]
            s = block_sign[ci]
            loadings_block = (X[:, bi].T @ Y[:, ci]) / n_obs
            for local_i, col in enumerate(bi):
                ind = indicators[col]
                loading_values[ind].append(s * float(loadings_block[local_i]))
                weight_values[ind].append(s * float(w[col]))

    path_stats = []
    for (src, tgt), bucket in path_values.items():
        orig = float(original.path_coefficients.loc[src, tgt])
        row = _summarize(bucket, orig, include_histogram=True)
        row.update(source=src, target=tgt)
        path_stats.append(row)

    specific_indirect_stats = []
    for route in routes:
        orig = 1.0
        for a, b in zip(route, route[1:]):
            orig *= float(original.path_coefficients.loc[a, b])
        row = _summarize(route_values[tuple(route)], orig, include_histogram=False)
        row.update(path=route)
        specific_indirect_stats.append(row)

    moderated_mediation_stats = []
    for mi, opp in enumerate(mm_opportunities):
        orig = 1.0
        for i, (a, b) in enumerate(zip(opp.route, opp.route[1:])):
            src = opp.interaction_id if i == opp.moderated_index else a
            orig *= float(original.path_coefficients.loc[src, b])
        row = _summarize(mm_values[mi], orig, include_histogram=False)
        row.update(route=opp.route, moderated_index=opp.moderated_index,
                    interaction_id=opp.interaction_id, moderator_id=opp.moderator_id)
        moderated_mediation_stats.append(row)

    loading_stats = []
    weight_stats = []
    for ind, bucket in loading_values.items():
        row = _summarize(bucket, float(original.outer_loadings[ind]))
        row.update(indicator=ind)
        loading_stats.append(row)
    for ind, bucket in weight_values.items():
        row = _summarize(bucket, float(original.outer_weights[ind]))
        row.update(indicator=ind)
        weight_stats.append(row)

    return BootstrapResult(
        n_requested=n_boot,
        n_valid=n_valid,
        path_stats=path_stats,
        loading_stats=loading_stats,
        weight_stats=weight_stats,
        specific_indirect_stats=specific_indirect_stats,
        moderated_mediation_stats=moderated_mediation_stats,
    )


def run_bootstrap_with_moderation(
    model: Model,
    original: PLSResult,
    n_boot: int = 500,
    seed: int | None = None,
    max_iterations: int = 300,
) -> BootstrapResult:
    """Same idea as `run_bootstrap`, extended for models with interaction
    (moderation) constructs, matching pls/moderation.py's point-estimate
    procedure per interaction construct's `calc_method`:

    - "product_indicator"/"orthogonalization" constructs already have real
      indicators (generated once from the full original sample — same
      simplification real PLS-SEM tools use for bootstrapping product terms —
      so each resample just selects rows from them like any other indicator)
      and need no special handling: they're plain topology members.
    - "two_stage" constructs still need stage 1 (the fast NumPy `_fit` loop)
      followed by forming their score as the product of their two source
      constructs' stage-1 scores and redoing the structural regression, all
      without pandas overhead in the hot loop.

    Sign correction (see `run_bootstrap`'s docstring) extends naturally to
    "two_stage" constructs: their effective sign for a given resample is the
    *product* of their two source constructs' signs, since flipping either
    factor of a product flips the product itself. "product_indicator"/
    "orthogonalization" constructs need no such special-casing — they get
    the same per-block sign correction as any other construct.
    """
    n_boot = max(MIN_BOOTSTRAP_SAMPLES, min(MAX_BOOTSTRAP_SAMPLES, int(n_boot)))
    rng = np.random.default_rng(seed)

    augmented_df, generated = _generate_indicator_based_interactions(model, original.data)
    stage1_model = Model.from_json(model.stage1_model_json(generated))
    base_indicators = stage1_model.all_indicators()
    topo = _build_topology(stage1_model, base_indicators)
    raw = augmented_df[base_indicators].values
    n_obs, p = raw.shape
    k_base = len(topo.construct_ids)
    base_pos = {cid: i for i, cid in enumerate(topo.construct_ids)}

    orig_w = original.outer_weights[base_indicators].values

    two_stage_ids = model.two_stage_interaction_ids()
    interaction_sources = {
        icid: (base_pos[model.constructs[icid].interaction_of[0]],
               base_pos[model.constructs[icid].interaction_of[1]])
        for icid in two_stage_ids
    }

    all_ids = list(model.constructs.keys())
    endogenous = [cid for cid in all_ids if model.predecessors(cid)]
    path_pairs = [(src, tgt) for tgt in endogenous for src in model.predecessors(tgt)]

    path_values: dict[tuple[str, str], list[float]] = {pair: [] for pair in path_pairs}
    loading_values: dict[str, list[float]] = {ind: [] for ind in base_indicators}
    weight_values: dict[str, list[float]] = {ind: [] for ind in base_indicators}

    routes = enumerate_indirect_routes(model)
    route_values: dict[tuple[str, ...], list[float]] = {tuple(r): [] for r in routes}

    mm_opportunities = find_moderated_mediation_opportunities(model)
    mm_values: list[list[float]] = [[] for _ in mm_opportunities]

    n_valid = 0
    for _ in range(n_boot):
        idx = rng.integers(0, n_obs, size=n_obs)
        X = _standardize_cols(raw[idx])
        try:
            w, Y, _n_iter, converged = _fit(X, topo, max_iterations, 1e-7)
        except np.linalg.LinAlgError:
            continue
        if not converged:
            continue
        n_valid += 1

        block_sign = np.empty(k_base)
        for ci in range(k_base):
            bi = topo.block_idx[ci]
            dot = float(np.dot(orig_w[bi], w[bi]))
            block_sign[ci] = 1.0 if dot >= 0 else -1.0

        def sign_of(cid: str) -> float:
            if cid in interaction_sources:
                pa, pb = interaction_sources[cid]
                return block_sign[pa] * block_sign[pb]
            return block_sign[base_pos[cid]]

        full_score: dict[str, np.ndarray] = {cid: Y[:, base_pos[cid]] for cid in topo.construct_ids}
        for icid in two_stage_ids:
            pa, pb = interaction_sources[icid]
            full_score[icid] = _standardize_cols((Y[:, pa] * Y[:, pb])[:, None])[:, 0]

        iter_coef: dict[tuple[str, str], float] = {}
        for tgt in endogenous:
            preds = model.predecessors(tgt)
            A = np.column_stack([full_score[p] for p in preds])
            beta = _ols_beta(A, full_score[tgt])[:-1]
            s_tgt = sign_of(tgt)
            for pi, src in enumerate(preds):
                signed_beta = sign_of(src) * s_tgt * float(beta[pi])
                path_values[(src, tgt)].append(signed_beta)
                iter_coef[(src, tgt)] = signed_beta

        for route in routes:
            prod = 1.0
            for a, b in zip(route, route[1:]):
                prod *= iter_coef[(a, b)]
            route_values[tuple(route)].append(prod)

        for mi, opp in enumerate(mm_opportunities):
            index = 1.0
            for i, (a, b) in enumerate(zip(opp.route, opp.route[1:])):
                index *= iter_coef[(opp.interaction_id, b)] if i == opp.moderated_index else iter_coef[(a, b)]
            mm_values[mi].append(index)

        for ci in range(k_base):
            bi = topo.block_idx[ci]
            s = block_sign[ci]
            loadings_block = (X[:, bi].T @ Y[:, ci]) / n_obs
            for local_i, col in enumerate(bi):
                ind = base_indicators[col]
                loading_values[ind].append(s * float(loadings_block[local_i]))
                weight_values[ind].append(s * float(w[col]))

    path_stats = []
    for (src, tgt), bucket in path_values.items():
        orig = float(original.path_coefficients.loc[src, tgt])
        row = _summarize(bucket, orig, include_histogram=True)
        row.update(source=src, target=tgt)
        path_stats.append(row)

    specific_indirect_stats = []
    for route in routes:
        orig = 1.0
        for a, b in zip(route, route[1:]):
            orig *= float(original.path_coefficients.loc[a, b])
        row = _summarize(route_values[tuple(route)], orig, include_histogram=False)
        row.update(path=route)
        specific_indirect_stats.append(row)

    moderated_mediation_stats = []
    for mi, opp in enumerate(mm_opportunities):
        orig = 1.0
        for i, (a, b) in enumerate(zip(opp.route, opp.route[1:])):
            src = opp.interaction_id if i == opp.moderated_index else a
            orig *= float(original.path_coefficients.loc[src, b])
        row = _summarize(mm_values[mi], orig, include_histogram=False)
        row.update(route=opp.route, moderated_index=opp.moderated_index,
                    interaction_id=opp.interaction_id, moderator_id=opp.moderator_id)
        moderated_mediation_stats.append(row)

    loading_stats = []
    weight_stats = []
    for ind, bucket in loading_values.items():
        row = _summarize(bucket, float(original.outer_loadings[ind]))
        row.update(indicator=ind)
        loading_stats.append(row)
    for ind, bucket in weight_values.items():
        row = _summarize(bucket, float(original.outer_weights[ind]))
        row.update(indicator=ind)
        weight_stats.append(row)

    return BootstrapResult(
        n_requested=n_boot,
        n_valid=n_valid,
        path_stats=path_stats,
        loading_stats=loading_stats,
        weight_stats=weight_stats,
        specific_indirect_stats=specific_indirect_stats,
        moderated_mediation_stats=moderated_mediation_stats,
    )
