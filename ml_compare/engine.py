"""Machine-learning comparison against a fitted SEM structural model.

For every endogenous construct (has at least one direct predecessor in the
structural model), treats its own score column as the target and its direct
predecessors' score columns as features -- exactly the same predictor set the
structural model itself uses for that construct -- then fits each selected
ML algorithm via k-fold cross-validation and reports:

  - out-of-sample fit (R²/RMSE for regressors; Accuracy/AUC for the one
    classifier, Logistic Regression, whose target is median-split into
    High/Low per training fold since SEM construct scores are continuous)
  - permutation importance on the held-out fold, computed the same way for
    every algorithm regardless of type -- the one importance measure that's
    genuinely comparable across linear coefficients, tree splits, SVM
    margins, and boosting gain, and what backs the top-level comparison
    against the SEM path coefficient for the same predictor -> target edge
  - each algorithm's own "native" importance where it has one (regression
    coefficient, or feature_importances_ for tree/boosting models), shown
    alongside permutation importance in that algorithm's detail section

Every algorithm is wrapped in a StandardScaler pipeline: this makes Linear
Regression's coefficients standardized betas (directly comparable in scale
to the SEM path coefficients, which are also standardized), and keeps
scale-sensitive algorithms (SVM, Logistic Regression) well-behaved -- with
no downside for the scale-insensitive tree/boosting algorithms.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance
from sklearn.metrics import accuracy_score, mean_squared_error, r2_score, roc_auc_score
from sklearn.model_selection import KFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from i18n import DEFAULT_LANG, t
from pls.model import Model

from .registry import ALGORITHMS

MIN_FOLD_SIZE = 2
N_PERMUTATION_REPEATS = 10

# Per-fit wall-clock cost is wildly uneven across algorithms -- measured
# against this app's own TAM sample (n=250, 2 predictors): Random Forest
# (n_estimators=200) and CatBoost (default 1000 iterations) are each
# ~1.2-1.3s per fit, XGBoost ~0.5s, everything else (Linear/Logistic
# Regression, Decision Tree, SVM, sklearn GBM, LightGBM) is under 0.25s.
# A flat "total fit count" budget would be meaningless across that ~65x
# spread, so the guard below weights each selected algorithm by its
# measured cost and caps the estimated total wall-clock time instead.
COST_PER_FIT_SECONDS = {
    "linreg": 0.06, "logreg": 0.03, "dtree": 0.02, "rf": 1.3,
    "svm": 0.21, "gbm": 0.24, "xgboost": 0.52, "lightgbm": 0.25, "catboost": 1.2,
}
MAX_ESTIMATED_SECONDS = 300


@dataclass
class AlgoOnTarget:
    algorithm_id: str
    task: str  # "regression" | "classification"
    metrics: dict[str, dict[str, float] | None]
    permutation_importance: dict[str, dict[str, float]]
    native_importance: dict[str, float] | None
    n_folds_used: int


@dataclass
class TargetResult:
    target_id: str
    target_name: str
    predictors: list[dict]  # [{"id", "name", "sem_coefficient"}]
    n_obs: int
    algorithms: dict[str, AlgoOnTarget] = field(default_factory=dict)


def _mean_std(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    arr = np.asarray(values, dtype=float)
    return {"mean": float(arr.mean()), "std": float(arr.std(ddof=0))}


def _extract_native_importance(kind: str, estimator) -> np.ndarray | None:
    if kind == "coefficient":
        coef = getattr(estimator, "coef_", None)
        if coef is None:
            return None
        return np.asarray(coef, dtype=float).reshape(-1)
    if kind == "tree":
        imp = getattr(estimator, "feature_importances_", None)
        if imp is None:
            return None
        return np.asarray(imp, dtype=float)
    return None


def _run_algorithm_on_target(
    algo_id: str, X: np.ndarray, y: np.ndarray, predictor_ids: list[str], k: int, seed: int,
) -> AlgoOnTarget:
    spec = ALGORITHMS[algo_id]
    kf = KFold(n_splits=k, shuffle=True, random_state=seed)

    r2s: list[float] = []
    rmses: list[float] = []
    accs: list[float] = []
    aucs: list[float] = []
    importances: dict[str, list[float]] = {p: [] for p in predictor_ids}
    native_rows: list[np.ndarray] = []
    n_folds_used = 0

    for train_idx, test_idx in kf.split(X):
        X_train, X_test = X[train_idx], X[test_idx]
        y_train_raw, y_test_raw = y[train_idx], y[test_idx]

        pipe = Pipeline([("scaler", StandardScaler()), ("model", spec.factory(seed))])

        if spec.task == "classification":
            threshold = np.median(y_train_raw)
            y_train = (y_train_raw > threshold).astype(int)
            y_test = (y_test_raw > threshold).astype(int)
            if len(np.unique(y_train)) < 2 or len(np.unique(y_test)) < 2:
                continue  # a degenerate median split on this fold -- skip it
            pipe.fit(X_train, y_train)
            y_pred = pipe.predict(X_test)
            accs.append(float(accuracy_score(y_test, y_pred)))
            y_proba = pipe.predict_proba(X_test)[:, 1]
            aucs.append(float(roc_auc_score(y_test, y_proba)))
            perm = permutation_importance(
                pipe, X_test, y_test, scoring="accuracy",
                n_repeats=N_PERMUTATION_REPEATS, random_state=seed, n_jobs=1,
            )
        else:
            pipe.fit(X_train, y_train_raw)
            y_pred = pipe.predict(X_test)
            r2s.append(float(r2_score(y_test_raw, y_pred)))
            rmses.append(float(np.sqrt(mean_squared_error(y_test_raw, y_pred))))
            perm = permutation_importance(
                pipe, X_test, y_test_raw, scoring="r2",
                n_repeats=N_PERMUTATION_REPEATS, random_state=seed, n_jobs=1,
            )

        for i, pid in enumerate(predictor_ids):
            importances[pid].append(float(perm.importances_mean[i]))

        native = _extract_native_importance(spec.native_importance_kind, pipe.named_steps["model"])
        if native is not None and native.shape[0] == len(predictor_ids):
            native_rows.append(native)

        n_folds_used += 1

    metrics: dict[str, dict[str, float] | None]
    if spec.task == "classification":
        metrics = {"accuracy": _mean_std(accs), "auc": _mean_std(aucs)}
    else:
        metrics = {"r2": _mean_std(r2s), "rmse": _mean_std(rmses)}

    native_importance = None
    if native_rows:
        stacked = np.vstack(native_rows)
        native_importance = {pid: float(stacked[:, i].mean()) for i, pid in enumerate(predictor_ids)}

    return AlgoOnTarget(
        algorithm_id=algo_id,
        task=spec.task,
        metrics=metrics,
        permutation_importance={pid: _mean_std(vals) for pid, vals in importances.items()},
        native_importance=native_importance,
        n_folds_used=n_folds_used,
    )


def run_ml_comparison(
    model: Model,
    scores_df: pd.DataFrame,
    sem_coefficients: dict[tuple[str, str], float],
    algorithm_ids: list[str],
    k: int = 5,
    seed: int = 123,
    lang: str = DEFAULT_LANG,
) -> list[TargetResult]:
    if not algorithm_ids:
        raise ValueError(t("err_ml_no_algorithms", lang))
    unknown = [a for a in algorithm_ids if a not in ALGORITHMS]
    if unknown:
        raise ValueError(t("err_ml_unknown_algorithm", lang, ids=", ".join(unknown)))
    unavailable = [a for a in algorithm_ids if not ALGORITHMS[a].available]
    if unavailable:
        raise ValueError(t("err_ml_algorithm_unavailable", lang, ids=", ".join(unavailable)))

    target_ids = [cid for cid in model.endogenous_ids() if model.predecessors(cid)]
    if not target_ids:
        raise ValueError(t("err_ml_no_targets", lang))

    n = len(scores_df)
    k_eff = max(2, min(k, n // MIN_FOLD_SIZE)) if n >= 2 * MIN_FOLD_SIZE else 0
    if k_eff < 2:
        raise ValueError(t("err_ml_insufficient_data", lang, n=n))

    estimated_seconds = len(target_ids) * k_eff * sum(COST_PER_FIT_SECONDS.get(a, 1.0) for a in algorithm_ids)
    if estimated_seconds > MAX_ESTIMATED_SECONDS:
        raise ValueError(t(
            "err_ml_budget_exceeded", lang,
            estimate=round(estimated_seconds), max=MAX_ESTIMATED_SECONDS,
        ))

    results: list[TargetResult] = []
    for tid in target_ids:
        preds = model.predecessors(tid)
        X = scores_df[preds].to_numpy(dtype=float)
        y = scores_df[tid].to_numpy(dtype=float)

        algorithms = {
            algo_id: _run_algorithm_on_target(algo_id, X, y, preds, k_eff, seed)
            for algo_id in algorithm_ids
        }

        results.append(TargetResult(
            target_id=tid,
            target_name=model.constructs[tid].name,
            predictors=[
                {
                    "id": p,
                    "name": model.constructs[p].name,
                    "sem_coefficient": sem_coefficients.get((p, tid)),
                }
                for p in preds
            ],
            n_obs=n,
            algorithms=algorithms,
        ))

    return results
