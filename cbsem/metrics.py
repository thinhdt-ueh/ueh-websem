"""Reliability & discriminant-validity metrics for a fitted CB-SEM model.

Cronbach's alpha and HTMT are computed straight from the raw indicator data,
so they're estimation-method-agnostic and the exact same functions used for
PLS-SEM apply unchanged. Composite reliability, AVE and Fornell-Larcker only
need a "loadings" vector — here the ML standardized factor loadings — so
those functions are reused too, just fed different inputs (see pls/metrics.py
for the formulas and references).
"""

from __future__ import annotations

from pls.metrics import ave, composite_reliability, cronbachs_alpha, fornell_larcker, htmt

from .estimator import CBSEMResult


def compute_all_cbsem_metrics(result: CBSEMResult) -> dict:
    model = result.model
    std_loadings = result.measurement["std"]

    alpha = cronbachs_alpha(model, result.scaled_data)
    cr = composite_reliability(model, std_loadings)
    ave_s = ave(model, std_loadings)
    fl = fornell_larcker(model, result.factor_scores, ave_s)
    ht = htmt(model, result.scaled_data)

    return {
        "cronbachs_alpha": alpha,
        "composite_reliability": cr,
        "ave": ave_s,
        "fornell_larcker": fl,
        "htmt": ht,
    }
