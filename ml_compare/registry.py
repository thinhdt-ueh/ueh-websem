"""Registry of ML algorithms available for the post-SEM comparison feature
(see ml_compare/engine.py). Soft-imports the three external boosting
libraries so the app still runs if one isn't installed in a given
environment -- unavailable algorithms are flagged via `AlgorithmSpec.available`
so the frontend can grey them out instead of the request failing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.svm import SVR
from sklearn.tree import DecisionTreeRegressor

try:
    from xgboost import XGBRegressor
    _XGBOOST_AVAILABLE = True
except ImportError:
    _XGBOOST_AVAILABLE = False

try:
    from lightgbm import LGBMRegressor
    _LIGHTGBM_AVAILABLE = True
except ImportError:
    _LIGHTGBM_AVAILABLE = False

try:
    from catboost import CatBoostRegressor
    _CATBOOST_AVAILABLE = True
except ImportError:
    _CATBOOST_AVAILABLE = False


@dataclass
class AlgorithmSpec:
    id: str
    name_key: str
    task: str  # "regression" | "classification"
    factory: Callable[[int], object]
    # How to read a fitted estimator's own importance signal, if it has one:
    # "coefficient" (linear/logistic beta), "tree" (feature_importances_), or
    # "none" (e.g. SVR with a non-linear kernel has neither).
    native_importance_kind: str
    available: bool = True


def _linreg(seed: int):
    return LinearRegression()


def _logreg(seed: int):
    return LogisticRegression(max_iter=1000, random_state=seed)


def _dtree(seed: int):
    return DecisionTreeRegressor(random_state=seed)


def _rf(seed: int):
    return RandomForestRegressor(n_estimators=200, random_state=seed, n_jobs=1)


def _svm(seed: int):
    return SVR()


def _gbm(seed: int):
    return GradientBoostingRegressor(random_state=seed)


def _xgboost(seed: int):
    return XGBRegressor(random_state=seed, verbosity=0, n_jobs=1)


def _lightgbm(seed: int):
    return LGBMRegressor(random_state=seed, verbose=-1, n_jobs=1)


def _catboost(seed: int):
    return CatBoostRegressor(random_state=seed, verbose=False, allow_writing_files=False)


ALGORITHMS: dict[str, AlgorithmSpec] = {
    "linreg": AlgorithmSpec("linreg", "ml_algo_linreg", "regression", _linreg, "coefficient"),
    "logreg": AlgorithmSpec("logreg", "ml_algo_logreg", "classification", _logreg, "coefficient"),
    "dtree": AlgorithmSpec("dtree", "ml_algo_dtree", "regression", _dtree, "tree"),
    "rf": AlgorithmSpec("rf", "ml_algo_rf", "regression", _rf, "tree"),
    "svm": AlgorithmSpec("svm", "ml_algo_svm", "regression", _svm, "none"),
    "gbm": AlgorithmSpec("gbm", "ml_algo_gbm", "regression", _gbm, "tree"),
    "xgboost": AlgorithmSpec(
        "xgboost", "ml_algo_xgboost", "regression", _xgboost, "tree", available=_XGBOOST_AVAILABLE,
    ),
    "lightgbm": AlgorithmSpec(
        "lightgbm", "ml_algo_lightgbm", "regression", _lightgbm, "tree", available=_LIGHTGBM_AVAILABLE,
    ),
    "catboost": AlgorithmSpec(
        "catboost", "ml_algo_catboost", "regression", _catboost, "tree", available=_CATBOOST_AVAILABLE,
    ),
}

# Selectable-algorithm order the frontend modal follows, grouped roughly the
# way the user originally listed them.
ALGORITHM_ORDER = ["linreg", "logreg", "dtree", "rf", "svm", "gbm", "xgboost", "lightgbm", "catboost"]
