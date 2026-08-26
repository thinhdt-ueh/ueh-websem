"""Monte Carlo a-priori power analysis for CB-SEM structural paths (under H1).

Same idea as pls/power_analysis.py (declare a population model, simulate
synthetic datasets at each candidate n, fit, count how often each path
comes out significant), but for CB-SEM. The synthetic-data generator
(`generate_synthetic_data`) is estimation-method-agnostic — it just
produces reflective indicator data from population path coefficients and
loadings — so it's reused unchanged from pls/power_analysis.py; only the
fitting/significance-testing step differs here.

Unlike PLS-SEM, CB-SEM's Maximum Likelihood estimation already gives an
analytic (Wald-test) standard error/z/p for every structural path directly
from the fit itself — significance never needs bootstrapping. So each
replicate here costs exactly one semopy fit, not one fit plus N bootstrap
resamples like the PLS-SEM version. Benchmarked on this app's own
4-construct/13-indicator sample model, one CB-SEM replicate takes ~44ms —
roughly 20x cheaper than one PLS-SEM replicate (which pays for
n_boot_inner extra fits) — so this module affords much higher n_mc/point
defaults within the same time budget.

Same scope restriction as the PLS-SEM version: reflective (Mode A) only,
no interaction/moderation construct — see `validate_population_model`.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from cbsem.estimator import run_cbsem
from i18n import DEFAULT_LANG, t
from pls.model import Model
from pls.power_analysis import (
    MAX_MC_REPLICATES,
    MIN_MC_REPLICATES,
    SIGNIFICANCE_ALPHA,
    PowerPoint,
    generate_synthetic_data,
    validate_population_model,
)

# ~20x cheaper per replicate than PLS-SEM (no inner bootstrap loop), so the
# same wall-clock budget affords far more total replicates — see this
# module's docstring for the benchmark this is based on (~44ms/replicate).
# 40,000 replicates extrapolates to ~1760s, leaving real margin under the
# 2400s gunicorn timeout (Procfile) for slower machines/models.
MAX_TOTAL_REPLICATES = 40_000


def run_power_analysis(
    model: Model,
    path_values: dict[tuple[str, str], float],
    loading_values: dict[str, float],
    sample_sizes: list[int],
    n_mc: int,
    seed: int | None = None,
    lang: str = DEFAULT_LANG,
) -> list[PowerPoint]:
    validate_population_model(model, path_values, loading_values, lang)

    n_mc = max(MIN_MC_REPLICATES, min(MAX_MC_REPLICATES, int(n_mc)))
    total_replicates = len(sample_sizes) * n_mc
    if total_replicates > MAX_TOTAL_REPLICATES:
        raise ValueError(t("err_power_budget_exceeded", lang, total=total_replicates, max=MAX_TOTAL_REPLICATES))

    rng = np.random.default_rng(seed)
    min_n = len(model.all_indicators()) + 5  # same floor run_cbsem enforces
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
                result = run_cbsem(model, df, lang=lang)
            except Exception:  # noqa: BLE001 — degenerate synthetic samples are expected at small n
                continue
            if not result.converged:
                continue
            n_converged += 1

            for _, row in result.structural.iterrows():
                key = (row["source"], row["target"])
                estimates[key].append(float(row["std"]))
                if pd.notna(row["p"]) and row["p"] < SIGNIFICANCE_ALPHA:
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
