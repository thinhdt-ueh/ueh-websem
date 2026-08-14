"""Two-stage approach to moderation analysis (Henseler & Chin 2010; Henseler &
Fassott 2010) — the standard way PLS-SEM (and, here, CB-SEM) tests whether one
construct's effect on another depends on the level of a third (moderator):

  Stage 1: fit the model WITHOUT the interaction term to get each construct's
           standardized score (composite score for PLS-SEM, factor score for
           CB-SEM — the two-stage method only needs "a score per construct",
           so the same procedure applies to both estimation engines).
  Stage 2: form the interaction term as the (re-standardized) product of its
           two source constructs' stage-1 scores — a single-indicator
           construct — then re-estimate the structural equation(s) that the
           interaction predicts, now including it (and the two source
           constructs' own direct "main effect" paths, enforced at model-
           validation time) as predictors.

This module holds the pieces shared by both engines: computing the
interaction score itself, and an OLS-with-standard-errors helper used by
CB-SEM's stage 2 (PLS-SEM's stage 2 instead gets its significance testing
from bootstrapping, like every other PLS-SEM path — see pls/bootstrap.py).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from i18n import DEFAULT_LANG

from .algorithm import PLSResult, run_pls_algorithm, structural_regression
from .model import Model


def compute_interaction_scores(model: Model, stage1_scores: pd.DataFrame) -> pd.DataFrame:
    """Product of each interaction construct's two source scores, re-standardized
    (mean 0, population variance 1) — standard practice for product terms, both
    to keep the score on a comparable scale to the other (standardized)
    constructs and to reduce its collinearity with the main-effect terms."""
    out = {}
    for cid in model.interaction_ids():
        a, b = model.constructs[cid].interaction_of
        raw = stage1_scores[a].values * stage1_scores[b].values
        std = raw.std(ddof=0)
        out[cid] = (raw - raw.mean()) / std if std > 0 else raw - raw.mean()
    return pd.DataFrame(out, index=stage1_scores.index)


def ols_with_inference(X: np.ndarray, y: np.ndarray):
    """OLS coefficients (excluding intercept) with classical standard errors,
    t-values, two-sided p-values, R² and adjusted R² — the textbook-correct
    way to test significance for a stage-2 two-stage-moderation regression,
    since that stage *is* literally an OLS regression on construct scores."""
    n, k = X.shape
    X1 = np.column_stack([X, np.ones(n)])
    XtX_inv = np.linalg.inv(X1.T @ X1)
    beta = XtX_inv @ X1.T @ y
    resid = y - X1 @ beta
    dof = n - k - 1
    ss_res = float(resid @ resid)
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    r2_adj = 1 - (1 - r2) * (n - 1) / dof if dof > 0 else float("nan")
    if dof > 0:
        sigma2 = ss_res / dof
        se = np.sqrt(np.diag(XtX_inv) * sigma2)
        t_stat = beta / se
        p_value = 2 * stats.t.sf(np.abs(t_stat), dof)
    else:
        se = np.full_like(beta, np.nan)
        t_stat = np.full_like(beta, np.nan)
        p_value = np.full_like(beta, np.nan)
    return beta[:-1], se[:-1], t_stat[:-1], p_value[:-1], r2, r2_adj


def run_pls_with_moderation(
    model: Model,
    df: pd.DataFrame,
    max_iterations: int = 300,
    tolerance: float = 1e-7,
    lang: str = DEFAULT_LANG,
) -> PLSResult:
    base_model = Model.from_json(model.base_model_json(), lang=lang)
    stage1 = run_pls_algorithm(base_model, df, max_iterations, tolerance, lang)

    interaction_scores = compute_interaction_scores(model, stage1.scores)
    full_scores = pd.concat([stage1.scores, interaction_scores], axis=1)
    construct_ids = list(model.constructs.keys())

    path_coefficients, r_squared, r_squared_adj = structural_regression(model, full_scores, construct_ids)

    return PLSResult(
        model=model,  # the FULL model (with interaction constructs) for downstream metrics
        data=stage1.data,
        scaled_data=stage1.scaled_data,
        outer_weights=stage1.outer_weights,
        outer_loadings=stage1.outer_loadings,
        cross_loadings=stage1.cross_loadings,
        scores=full_scores,
        path_coefficients=path_coefficients,
        r_squared=r_squared,
        r_squared_adj=r_squared_adj,
        iterations=stage1.iterations,
        converged=stage1.converged,
    )
