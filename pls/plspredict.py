"""PLSpredict: out-of-sample predictive validity for PLS-SEM (Shmueli, Ringle
& Sarstedt 2016, "The elephant in the room"; Shmueli et al. 2019). Answers a
different question than in-sample R²: if the model were used to predict new
respondents' answers on the endogenous indicators, how far off would it be —
and is that better or worse than a naive linear-regression benchmark?

Procedure, k-fold cross-validation (default k=10, fixed seed for
reproducibility rather than SmartPLS' multiple repeated runs):
  For each fold, holding that fold out as the test set and training on the
  rest:
    1. Fit the ordinary PLS algorithm on the training fold only.
    2. Compute the test fold's construct scores using the TRAINING fold's
       outer weights and standardization (mean/std) — never anything derived
       from the test fold itself, or this wouldn't be an out-of-sample check.
    3. Propagate predictions through the structural model in topological
       order: an exogenous construct's "predicted" score is just its own
       (weight-derived) score; an endogenous construct's predicted score is
       its training-fold path coefficients applied to its predictors'
       PREDICTED scores (not their own indicator-derived scores) — so
       prediction error compounds through the model exactly as it would for
       a genuinely new respondent.
    4. Map each endogenous reflective indicator's predicted construct score
       back to its raw scale via the training fold's loading and mean/std,
       and compare to the actual held-out value.
    5. Benchmark: an ordinary OLS regression of the same indicator on the
       raw indicators of its construct's direct predecessors (not their
       composite scores) — the standard "LM" comparison per Shmueli et al.

  RMSE/MAE are pooled across all folds' held-out errors per indicator. PLS
  "wins" an indicator when its RMSE is lower than the LM benchmark's; the
  overall verdict follows Shmueli et al.'s rule of thumb: high predictive
  power if PLS wins every indicator, medium if it wins most, low otherwise
  (a sign of overfitting relative to a simple linear benchmark).

Not supported for models containing an interaction/moderation construct
(mode "I") — scoped out for now rather than risk a subtly wrong prediction
formula for a case that needs its own careful treatment.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from i18n import DEFAULT_LANG, t

from .algorithm import _ols_beta, run_pls_algorithm
from .model import Model

MIN_FOLD_SIZE = 2


@dataclass
class IndicatorPrediction:
    indicator: str
    construct_id: str
    pls_rmse: float
    pls_mae: float
    lm_rmse: float
    lm_mae: float
    pls_wins: bool


@dataclass
class PLSPredictResult:
    k: int
    n_obs: int
    predictions: list[IndicatorPrediction] = field(default_factory=list)
    n_wins: int = 0
    n_total: int = 0
    verdict: str = "low"  # "high" | "medium" | "low" | "none"


def run_plspredict(
    model: Model, df: pd.DataFrame, k: int = 10, seed: int = 123, lang: str = DEFAULT_LANG,
) -> PLSPredictResult:
    if model.has_interactions():
        raise ValueError(t("err_plspredict_no_interactions", lang))

    indicators = model.all_indicators()
    missing = [c for c in indicators if c not in df.columns]
    if missing:
        raise ValueError(t("err_missing_indicator_columns", lang, cols=", ".join(missing)))
    data = df[indicators].apply(pd.to_numeric, errors="coerce").dropna().reset_index(drop=True)
    n = len(data)

    k = max(2, min(k, n // MIN_FOLD_SIZE)) if n >= 2 * MIN_FOLD_SIZE else 0
    if k < 2:
        raise ValueError(t("err_plspredict_insufficient_data", lang, n=n))

    target_ids = [
        cid for cid in model.endogenous_ids()
        if model.constructs[cid].mode == "A" and model.constructs[cid].indicators
    ]
    if not target_ids:
        raise ValueError(t("err_plspredict_no_targets", lang))

    order = model.topological_order()

    rng = np.random.default_rng(seed)
    shuffled = rng.permutation(n)
    folds = np.array_split(shuffled, k)

    pls_errors: dict[str, list[float]] = {ind: [] for cid in target_ids for ind in model.constructs[cid].indicators}
    lm_errors: dict[str, list[float]] = {ind: [] for cid in target_ids for ind in model.constructs[cid].indicators}

    for fold_i in range(k):
        test_idx = folds[fold_i]
        train_idx = np.concatenate([folds[j] for j in range(k) if j != fold_i])
        if len(test_idx) == 0 or len(train_idx) < len(indicators) + 5:
            continue
        train_df = data.iloc[train_idx]
        test_df = data.iloc[test_idx]

        train_result = run_pls_algorithm(model, train_df, lang=lang)
        train_mean = train_df[indicators].mean()
        train_std = train_df[indicators].std(ddof=0).replace(0, 1.0)
        test_std_X = (test_df[indicators] - train_mean) / train_std

        # step 2: every construct's own weight-derived score on the test fold
        own_score = {
            cid: (test_std_X[c.indicators].values @ train_result.outer_weights[c.indicators].values)
            for cid, c in model.constructs.items()
        }

        # step 3: propagate predictions structurally, in topological order
        predicted_score: dict[str, np.ndarray] = {}
        for cid in order:
            preds = model.predecessors(cid)
            if not preds:
                predicted_score[cid] = own_score[cid]
            else:
                beta = train_result.path_coefficients[cid]
                predicted_score[cid] = sum(float(beta[p]) * predicted_score[p] for p in preds)

        # step 4: PLS prediction error, mapped back to indicator scale
        for cid in target_ids:
            for ind in model.constructs[cid].indicators:
                loading = float(train_result.outer_loadings[ind])
                predicted_raw = train_mean[ind] + loading * predicted_score[cid] * train_std[ind]
                actual_raw = test_df[ind].values
                pls_errors[ind].extend((actual_raw - predicted_raw).tolist())

        # step 5: LM benchmark — OLS on the raw indicators of direct predecessors
        for cid in target_ids:
            preds = model.predecessors(cid)
            pred_indicators = [i for p in preds for i in model.constructs[p].indicators]
            X_train = train_df[pred_indicators].values
            X_test = test_df[pred_indicators].values
            for ind in model.constructs[cid].indicators:
                y_train = train_df[ind].values
                beta_full = _ols_beta(X_train, y_train)
                y_pred = np.column_stack([X_test, np.ones(len(X_test))]) @ beta_full
                y_actual = test_df[ind].values
                lm_errors[ind].extend((y_actual - y_pred).tolist())

    predictions: list[IndicatorPrediction] = []
    for cid in target_ids:
        for ind in model.constructs[cid].indicators:
            pe = np.asarray(pls_errors[ind], dtype=float)
            le = np.asarray(lm_errors[ind], dtype=float)
            if pe.size == 0 or le.size == 0:
                continue
            pls_rmse = float(np.sqrt(np.mean(pe**2)))
            pls_mae = float(np.mean(np.abs(pe)))
            lm_rmse = float(np.sqrt(np.mean(le**2)))
            lm_mae = float(np.mean(np.abs(le)))
            predictions.append(IndicatorPrediction(
                indicator=ind, construct_id=cid,
                pls_rmse=pls_rmse, pls_mae=pls_mae, lm_rmse=lm_rmse, lm_mae=lm_mae,
                pls_wins=pls_rmse < lm_rmse,
            ))

    n_total = len(predictions)
    n_wins = sum(1 for p in predictions if p.pls_wins)
    if n_total == 0:
        verdict = "none"
    elif n_wins == n_total:
        verdict = "high"
    elif n_wins > n_total / 2:
        verdict = "medium"
    else:
        verdict = "low"

    return PLSPredictResult(k=k, n_obs=n, predictions=predictions, n_wins=n_wins, n_total=n_total, verdict=verdict)
