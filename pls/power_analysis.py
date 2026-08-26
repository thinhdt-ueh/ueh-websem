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

Scope: reflective (Mode A) constructs only, no interaction/moderation
constructs (mode "I") and no formative (mode "B") constructs — see
`run_power_analysis`'s validation. Both need a materially different
data-generating process; out of scope for now rather than risk a subtly
wrong one.
"""

from __future__ import annotations

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
    noise`, so the population loading is recovered in expectation."""
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
        noise_var = max(1.0 - lam * lam, MIN_INDICATOR_NOISE_VARIANCE)
        noise_sd = np.sqrt(noise_var)
        for ind in construct.indicators:
            data[ind] = lam * scores[cid] + noise_sd * rng.standard_normal(n)
    return pd.DataFrame(data)


@dataclass
class PowerPoint:
    n: int
    source: str
    target: str
    power: float
    n_converged: int
    n_replicates: int
    mean_estimate: float | None


def validate_population_model(
    model: Model,
    path_values: dict[tuple[str, str], float],
    loading_values: dict[str, float],
    lang: str,
) -> None:
    """Shared by both engines' power analysis (see cbsem/power_analysis.py) —
    the population-model requirements (reflective-only, no interactions,
    every path/construct covered) don't depend on which estimator will fit
    the synthetic data afterwards."""
    if model.has_interactions():
        raise ValueError(t("err_power_no_interactions", lang))
    for c in model.constructs.values():
        if c.mode != "A":
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
) -> list[PowerPoint]:
    validate_population_model(model, path_values, loading_values, lang)

    n_mc = max(MIN_MC_REPLICATES, min(MAX_MC_REPLICATES, int(n_mc)))
    n_boot_inner = max(MIN_BOOT_INNER, min(MAX_BOOT_INNER, int(n_boot_inner)))
    total_fits = len(sample_sizes) * n_mc * (1 + n_boot_inner)
    if total_fits > MAX_TOTAL_FITS:
        raise ValueError(t("err_power_budget_exceeded", lang, total=total_fits, max=MAX_TOTAL_FITS))

    rng = np.random.default_rng(seed)
    min_n = len(model.all_indicators()) + 5  # same floor run_pls_algorithm enforces
    points: list[PowerPoint] = []

    for n in sample_sizes:
        if n < min_n:
            for p in model.paths:
                points.append(PowerPoint(n=n, source=p.source, target=p.target, power=0.0,
                                          n_converged=0, n_replicates=0, mean_estimate=None))
            continue

        detected = {(p.source, p.target): 0 for p in model.paths}
        estimates = {(p.source, p.target): [] for p in model.paths}
        n_converged = 0

        for _ in range(n_mc):
            df = generate_synthetic_data(model, path_values, loading_values, n, rng)
            try:
                result = run_pls_algorithm(model, df, lang=lang)
            except (ValueError, np.linalg.LinAlgError):
                continue
            if not result.converged:
                continue
            n_converged += 1

            try:
                boot = run_bootstrap(model, result, n_boot=n_boot_inner, seed=int(rng.integers(0, 2**31 - 1)))
            except np.linalg.LinAlgError:
                continue
            for row in boot.path_stats:
                key = (row["source"], row["target"])
                estimates[key].append(row["original"])
                if row["p_value"] is not None and row["p_value"] < SIGNIFICANCE_ALPHA:
                    detected[key] += 1

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
