"""PLS-SEM moderation analysis, supporting the three standard ways of forming
an interaction/moderation term's score (selectable per interaction construct,
`Construct.calc_method`):

  "two_stage" (Henseler & Chin 2010; Henseler & Fassott 2010):
      Stage 1: fit the model WITHOUT the interaction term to get each
               construct's standardized composite score.
      Stage 2: form the interaction term as the (re-standardized) product of
               its two source constructs' stage-1 scores — a single-indicator
               construct — then re-estimate the structural equation(s) it
               predicts, now including it as a predictor.

  "product_indicator" (Chin, Marcolin & Newsted 2003):
      Multiply every pair of raw indicators from the two source blocks to
      form the interaction term's OWN Mode A indicator block, then estimate
      the whole model — main effects and interaction alike — in one single
      pass, since its score no longer depends on anything computed later.

  "orthogonalization" (Little, Bovaird & Widaman 2006):
      Same product-indicator construction, but each raw product is first
      residualized against every main-effect indicator of both source blocks,
      removing the collinearity a raw product otherwise has with the main
      effects it's meant to control for. Also a single-pass estimation.

Since "two_stage" is the only method whose score genuinely can't be known
until a first pass has run, `run_pls_with_moderation` runs ONE main PLS pass
over a model where every "product_indicator"/"orthogonalization" interaction
has already been turned into a real construct (see `Model.stage1_model_json`),
and only afterwards — if any "two_stage" interactions remain — computes their
score from that pass's factor scores and redoes the structural regression to
include them.

This module also holds an OLS-with-standard-errors helper used by CB-SEM's
stage 2 (PLS-SEM's own two-stage paths instead get their significance testing
from bootstrapping, like every other PLS-SEM path — see pls/bootstrap.py).
CB-SEM doesn't support product-indicator/orthogonalization (see
cbsem/moderation.py), so it always treats every interaction as "two_stage"
regardless of what was configured.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from i18n import DEFAULT_LANG

from .algorithm import PLSResult, _ols_beta, run_pls_algorithm, structural_regression
from .model import Model


def _transform_indicator(series: pd.Series, method: str) -> pd.Series:
    if method == "mean_centered":
        return series - series.mean()
    if method == "standardized":
        std = series.std(ddof=0)
        return (series - series.mean()) / std if std > 0 else series - series.mean()
    return series  # "unstandardized"


def build_product_indicators(
    df: pd.DataFrame,
    indicators_a: list[str],
    indicators_b: list[str],
    product_term_generation: str,
    orthogonalize: bool,
    prefix: str,
) -> tuple[pd.DataFrame, list[str]]:
    """One product-indicator column per (indicator_a, indicator_b) pair (Chin,
    Marcolin & Newsted 2003): the classic "multiply every pair of raw
    indicators from the two source blocks" construction for an interaction
    term's own Mode A indicator block. When `orthogonalize` is set, each raw
    product is additionally residualized (via OLS) against every main-effect
    indicator from both source blocks (Little, Bovaird & Widaman 2006)."""
    ta = {ind: _transform_indicator(df[ind].astype(float), product_term_generation).values for ind in indicators_a}
    tb = {ind: _transform_indicator(df[ind].astype(float), product_term_generation).values for ind in indicators_b}

    residualize_against = None
    if orthogonalize:
        residualize_against = np.column_stack([df[ind].astype(float).values for ind in indicators_a + indicators_b])

    out = {}
    col_names = []
    for ia in indicators_a:
        for ib in indicators_b:
            col = f"{prefix}__{ia}_x_{ib}"
            product = ta[ia] * tb[ib]
            if residualize_against is not None:
                beta = _ols_beta(residualize_against, product)
                yhat = np.column_stack([residualize_against, np.ones(len(product))]) @ beta
                product = product - yhat
            out[col] = product
            col_names.append(col)
    return pd.DataFrame(out, index=df.index), col_names


def _generate_indicator_based_interactions(
    model: Model, df: pd.DataFrame
) -> tuple[pd.DataFrame, dict[str, list[str]]]:
    """Adds product-indicator columns for every "product_indicator"/
    "orthogonalization" interaction construct to a copy of `df`, returning the
    augmented dataframe plus a {construct_id: [generated column names]} map
    for `Model.stage1_model_json`.

    Assigns columns by name (`augmented[col] = ...`) rather than concatenating
    a new frame, so this stays idempotent if `df` already carries generated
    columns from an earlier call (e.g. bootstrap resampling reuses the point
    estimate's `PLSResult.data`, which is itself already augmented) — a concat
    there would instead duplicate every generated column name and silently
    corrupt the indicator matrix built from `stage1_model.all_indicators()`.
    """
    augmented = df.copy()
    generated: dict[str, list[str]] = {}
    for cid in model.indicator_based_interaction_ids():
        c = model.constructs[cid]
        a, b = c.interaction_of
        cols_df, col_names = build_product_indicators(
            augmented, model.constructs[a].indicators, model.constructs[b].indicators,
            c.product_term_generation, orthogonalize=(c.calc_method == "orthogonalization"), prefix=cid,
        )
        for col in col_names:
            augmented[col] = cols_df[col]
        generated[cid] = col_names
    return augmented, generated


def compute_interaction_scores(
    model: Model, stage1_scores: pd.DataFrame, ids: list[str] | None = None
) -> pd.DataFrame:
    """Product of each "two_stage" interaction construct's two source scores,
    re-standardized (mean 0, population variance 1) — standard practice for
    product terms, both to keep the score on a comparable scale to the other
    (standardized) constructs and to reduce its collinearity with the
    main-effect terms. `ids` defaults to every interaction construct in the
    model (CB-SEM's usage, which always treats all of them as two-stage)."""
    out = {}
    for cid in (ids if ids is not None else model.interaction_ids()):
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
    augmented_df, generated = _generate_indicator_based_interactions(model, df)
    stage1_model = Model.from_json(model.stage1_model_json(generated), lang=lang)
    stage1 = run_pls_algorithm(stage1_model, augmented_df, max_iterations, tolerance, lang)

    two_stage_ids = model.two_stage_interaction_ids()
    if two_stage_ids:
        interaction_scores = compute_interaction_scores(model, stage1.scores, two_stage_ids)
        full_scores = pd.concat([stage1.scores, interaction_scores], axis=1)
    else:
        full_scores = stage1.scores
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
