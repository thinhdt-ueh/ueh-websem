"""Monte Carlo a-priori power analysis for PLS-SEM structural paths (under H1).

No PLS-SEM software ships a closed-form power calculation, because PLS has
no maximum-likelihood-based standard error to plug into one — significance
is always assessed via bootstrapping. Monte Carlo simulation is the only
rigorous way to answer "what's the probability I'd detect this hypothesized
effect at sample size n?": declare a population structural/measurement
model, repeatedly (a) generate a synthetic dataset of size n from it, (b)
fit the ordinary PLS algorithm, (c) bootstrap that fit for significance, and
count how often each path comes out significant. That fraction is the
empirical power for that path at that n.

Reuses the exact estimation/bootstrap code every real analysis in this app
uses (`run_pls_algorithm`, `run_bootstrap`) — this module only adds the
synthetic-data generator and the outer simulation loop.

Scope: reflective (Mode A) and formative (Mode B) constructs; no
interaction/moderation constructs (mode "I"), which would need a
materially different data-generating process. Formative blocks are
generated from a composite population model (see
`_formative_indicators`), and are PLS-SEM only — CB-SEM cannot estimate
formative blocks at all (cbsem/estimator.py).
"""

from __future__ import annotations

from collections.abc import Callable

from dataclasses import dataclass

import numpy as np
import pandas as pd

from i18n import DEFAULT_LANG, t

from .algorithm import run_pls_algorithm
from .bootstrap import run_bootstrap
from .model import Model

MIN_MC_REPLICATES = 20
MAX_MC_REPLICATES = 500
# `run_bootstrap` itself floors n_boot at MIN_BOOTSTRAP_SAMPLES (100, see
# pls/bootstrap.py) — matching that here rather than pretending a lower
# value is honored, which it wouldn't be.
MIN_BOOT_INNER = 100
MAX_BOOT_INNER = 300
MAX_SAMPLE_SIZE_POINTS = 50
# Benchmarked end-to-end on this app's own 4-construct/13-indicator sample
# model, sustained over a longer run (10 sample-size points x 30 MC
# replicates x 100 inner bootstrap resamples = 232s, i.e. ~7.7ms per inner
# PLS fit) — a short 4-point run alone under-measured this by ~2x, so this
# number comes from the longer, more representative sample. At the default
# n_mc/n_boot_inner, 50 x 30 x 101 ~= 151,500 fits (~19 minutes); this cap
# additionally allows headroom up to ~50 x 50 x 101 ~= 252,500 fits
# (~32 minutes) for a user who also raises n_mc. Accepted per explicit
# request to prioritize point-count resolution over runtime — this cap is
# the real budget backstop regardless of how a request splits fits between
# points/replicates/bootstraps — it, not MAX_SAMPLE_SIZE_POINTS alone, is
# what keeps a request inside the 2400s gunicorn timeout (Procfile), with
# margin for slower machines — see routes/power_api.py's pre-flight check
# using it. Note: this long a synchronous request is only reliable for
# local/desktop use (dev server or the packaged .exe, no intermediary
# proxy) — a platform-level timeout in front of a hosted deployment (e.g.
# Render) may still cut the connection well before this regardless of
# gunicorn's own timeout.
MAX_TOTAL_FITS = 250_000
SIGNIFICANCE_ALPHA = 0.05
# Guards sqrt() against a user-specified population that implies a
# construct's disturbance variance is zero or negative (e.g. path
# coefficients on correlated predictors that jointly "use up" more than
# 100% of the outcome's variance) — degrade gracefully instead of crashing.
MIN_DISTURBANCE_VARIANCE = 0.01
MIN_INDICATOR_NOISE_VARIANCE = 0.0001


def generate_synthetic_data(
    model: Model,
    path_values: dict[tuple[str, str], float],
    loading_values: dict[str, float],
    n: int,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """One synthetic dataset of size n drawn from the declared population
    model. Exogenous constructs are i.i.d. standard normal; an endogenous
    construct's score is the population-weighted sum of its predictors'
    *already-generated, realized* scores for this replicate, plus
    calibrated-variance noise so Var(score) == 1 exactly — using the
    realized columns (rather than assuming predictor independence) makes
    this correct even when predictors are correlated (e.g. serial/parallel
    mediation chains sharing an upstream exogenous construct). Each
    indicator of a Mode A construct is then `loading * score +
    noise`, so the population loading is recovered in expectation; a Mode B
    construct's indicators come from `_formative_indicators`."""
    scores: dict[str, np.ndarray] = {}
    for cid in model.topological_order():
        preds = model.predecessors(cid)
        if not preds:
            scores[cid] = rng.standard_normal(n)
            continue
        eta_lin = np.zeros(n)
        for p in preds:
            eta_lin += path_values[(p, cid)] * scores[p]
        disturbance_var = max(1.0 - float(np.var(eta_lin)), MIN_DISTURBANCE_VARIANCE)
        scores[cid] = eta_lin + rng.standard_normal(n) * np.sqrt(disturbance_var)

    data: dict[str, np.ndarray] = {}
    for cid, construct in model.constructs.items():
        lam = loading_values[cid]
        if construct.mode == "B":
            block = _formative_indicators(scores[cid], lam, len(construct.indicators), rng)
            for j, ind in enumerate(construct.indicators):
                data[ind] = block[:, j]
            continue
        noise_var = max(1.0 - lam * lam, MIN_INDICATOR_NOISE_VARIANCE)
        noise_sd = np.sqrt(noise_var)
        for ind in construct.indicators:
            data[ind] = lam * scores[cid] + noise_sd * rng.standard_normal(n)
    return pd.DataFrame(data)


def _formative_indicators(score: np.ndarray, loading: float, k: int, rng: np.random.Generator) -> np.ndarray:
    """Indicators of a formative (composite) block whose equally weighted
    composite reproduces `score` exactly.

    Population: k standardized indicators with common intercorrelation rho,
    composite eta = w'x with equal weights scaled so Var(eta) = 1. Each
    indicator's correlation with eta (its "loading", which is what PLS
    reports as the outer loading of a Mode B indicator and what the power
    modal asks for) is then sqrt((1 + (k-1) rho) / k), so rho is solved
    from the requested loading: rho = (k loading^2 - 1) / (k - 1). Any
    loading in (0, 1) gives a positive-definite rho > -1/(k-1).

    Drawing x | eta ~ N(loading * eta * 1, Sigma - loading^2 * 11') makes
    w'x == eta hold exactly in every replicate; that conditional covariance
    simplifies to (1 - rho)(I - 11'/k), i.e. scaled, row-centered white
    noise -- so no matrix factorization is needed."""
    n = score.shape[0]
    if k == 1:
        return score.reshape(n, 1).copy()
    lam = float(np.clip(loading, 0.01, 0.999))
    rho = (k * lam * lam - 1.0) / (k - 1)
    rho = float(np.clip(rho, -1.0 / (k - 1) + 1e-3, 0.999))
    lam = np.sqrt((1.0 + (k - 1) * rho) / k)
    noise = rng.standard_normal((n, k))
    noise -= noise.mean(axis=1, keepdims=True)
    return lam * score[:, None] + np.sqrt(1.0 - rho) * noise


@dataclass
class PowerPoint:
    n: int
    source: str
    target: str
    power: float
    n_converged: int
    n_replicates: int
    mean_estimate: float | None


def _pls_replicate(model, path_values, loading_values, n_boot_inner, lang, n, seed_seq):
    """One Monte Carlo replicate at sample size n: simulate, fit, bootstrap.
    Returns None if the fit failed/didn't converge, else a list of
    (source, target, estimate, significant) -- empty if only the bootstrap
    failed (the replicate still counts as converged, as before).
    Module-level so worker processes can unpickle it (pls/parallel.py)."""
    rng = np.random.default_rng(seed_seq)
    df = generate_synthetic_data(model, path_values, loading_values, n, rng)
    try:
        result = run_pls_algorithm(model, df, lang=lang)
    except (ValueError, np.linalg.LinAlgError):
        return None
    if not result.converged:
        return None
    try:
        boot = run_bootstrap(model, result, n_boot=n_boot_inner, seed=int(rng.integers(0, 2**31 - 1)))
    except np.linalg.LinAlgError:
        return []
    return [
        (row["source"], row["target"], row["original"],
         row["p_value"] is not None and row["p_value"] < SIGNIFICANCE_ALPHA)
        for row in boot.path_stats
    ]


def run_replicates(
    replicate_fn: Callable,
    fixed_args: tuple,
    sample_sizes: list[int],
    n_mc: int,
    min_n: int,
    seed: int | None,
    progress: Callable[[int, int], None] | None,
) -> dict[int, list]:
    """Runs n_mc replicates per sample size on the shared process pool
    (pls/parallel.py) and returns {n: [replicate results]}.

    Every replicate gets its own child SeedSequence, so results depend only
    on `seed` -- not on how many workers ran them or in which order they
    finished. Progress is counted in replicates weighted by their n (a fit's
    cost grows with n, keeping the page's remaining-time extrapolation
    honest); sample sizes below min_n are skipped instantly. If `progress`
    raises (the job was cancelled), queued replicates are cancelled too."""
    from .parallel import run_tasks

    seeds = iter(np.random.SeedSequence(seed).spawn(len(sample_sizes) * n_mc))
    tasks, weights = [], []
    skipped_work = 0
    for n in sample_sizes:
        for _ in range(n_mc):
            seed_seq = next(seeds)  # drawn for skipped sizes too, keeping seeds stable
            if n >= min_n:
                tasks.append((*fixed_args, n, seed_seq))
                weights.append(n)
        if n < min_n:
            skipped_work += n_mc * n

    def report(done, total):
        if progress:
            progress(done + skipped_work, total + skipped_work)

    results = run_tasks(replicate_fn, tasks, weights, report)
    by_n: dict[int, list] = {n: [] for n in sample_sizes}
    for args, result in zip(tasks, results):
        by_n[args[-2]].append(result)
    return by_n


def summarize_replicates(model: Model, sample_sizes: list[int], n_mc: int, by_n: dict[int, list]) -> list[PowerPoint]:
    points: list[PowerPoint] = []
    for n in sample_sizes:
        results = by_n.get(n) or []
        if not results:
            for p in model.paths:
                points.append(PowerPoint(n=n, source=p.source, target=p.target, power=0.0,
                                          n_converged=0, n_replicates=0, mean_estimate=None))
            continue
        detected = {(p.source, p.target): 0 for p in model.paths}
        estimates = {(p.source, p.target): [] for p in model.paths}
        n_converged = 0
        for rows in results:
            if rows is None:
                continue
            n_converged += 1
            for source, target, estimate, significant in rows:
                estimates[(source, target)].append(estimate)
                if significant:
                    detected[(source, target)] += 1
        for p in model.paths:
            key = (p.source, p.target)
            vals = estimates[key]
            points.append(PowerPoint(
                n=n, source=p.source, target=p.target,
                power=(detected[key] / n_converged) if n_converged else 0.0,
                n_converged=n_converged, n_replicates=n_mc,
                mean_estimate=(sum(vals) / len(vals)) if vals else None,
            ))
    return points


def validate_population_model(
    model: Model,
    path_values: dict[tuple[str, str], float],
    loading_values: dict[str, float],
    lang: str,
    allow_formative: bool = True,
) -> None:
    """Shared by both engines' power analysis (see cbsem/power_analysis.py) —
    the population-model requirements (no interactions, every path/construct
    covered) don't depend on which estimator will fit the synthetic data
    afterwards; only formative blocks do, since CB-SEM can't estimate them
    (`allow_formative=False`)."""
    if model.has_interactions():
        raise ValueError(t("err_power_no_interactions", lang))
    allowed_modes = ("A", "B") if allow_formative else ("A",)
    for c in model.constructs.values():
        if c.mode not in allowed_modes:
            raise ValueError(t("err_power_reflective_only", lang, name=c.name))
        if c.id not in loading_values:
            raise ValueError(t("err_power_missing_loading", lang, name=c.name))
    for p in model.paths:
        if (p.source, p.target) not in path_values:
            raise ValueError(t(
                "err_power_missing_path_value", lang,
                src=model.constructs[p.source].name, tgt=model.constructs[p.target].name,
            ))


def run_power_analysis(
    model: Model,
    path_values: dict[tuple[str, str], float],
    loading_values: dict[str, float],
    sample_sizes: list[int],
    n_mc: int,
    n_boot_inner: int,
    seed: int | None = None,
    lang: str = DEFAULT_LANG,
    progress: Callable[[int, int], None] | None = None,
) -> list[PowerPoint]:
    validate_population_model(model, path_values, loading_values, lang)

    n_mc = max(MIN_MC_REPLICATES, min(MAX_MC_REPLICATES, int(n_mc)))
    n_boot_inner = max(MIN_BOOT_INNER, min(MAX_BOOT_INNER, int(n_boot_inner)))
    total_fits = len(sample_sizes) * n_mc * (1 + n_boot_inner)
    if total_fits > MAX_TOTAL_FITS:
        raise ValueError(t("err_power_budget_exceeded", lang, total=total_fits, max=MAX_TOTAL_FITS))

    min_n = len(model.all_indicators()) + 5  # same floor run_pls_algorithm enforces
    by_n = run_replicates(
        _pls_replicate, (model, path_values, loading_values, n_boot_inner, lang),
        sample_sizes, n_mc, min_n, seed, progress,
    )
    return summarize_replicates(model, sample_sizes, n_mc, by_n)
