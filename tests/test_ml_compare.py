"""Unit tests for ml_compare.engine: the post-SEM ML comparison feature."""

from __future__ import annotations

import pytest

from ml_compare.engine import MAX_ESTIMATED_SECONDS, run_ml_comparison
from ml_compare.registry import ALGORITHM_ORDER
from pls.algorithm import run_pls_algorithm
from pls.model import Model


@pytest.fixture
def tam_fit(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    fit = run_pls_algorithm(model, tam_df)
    sem_coef = {
        (p.source, p.target): float(fit.path_coefficients.loc[p.source, p.target]) for p in model.paths
    }
    return model, fit, sem_coef


def test_every_endogenous_construct_gets_a_target_result(tam_fit):
    model, fit, sem_coef = tam_fit
    targets = run_ml_comparison(model, fit.scores, sem_coef, ["linreg", "rf"], k=3, seed=1)
    target_ids = {t.target_id for t in targets}
    assert target_ids == set(model.endogenous_ids()) == {"pu", "att", "int"}


def test_permutation_importance_keys_match_predictor_set(tam_fit):
    model, fit, sem_coef = tam_fit
    targets = run_ml_comparison(model, fit.scores, sem_coef, ["linreg"], k=3, seed=1)
    for tr in targets:
        predictor_ids = {p["id"] for p in tr.predictors}
        assert predictor_ids == set(model.predecessors(tr.target_id))
        for ao in tr.algorithms.values():
            assert set(ao.permutation_importance.keys()) == predictor_ids


def test_sem_coefficient_echoed_matches_the_fit(tam_fit):
    model, fit, sem_coef = tam_fit
    targets = run_ml_comparison(model, fit.scores, sem_coef, ["linreg"], k=3, seed=1)
    by_target = {t.target_id: t for t in targets}
    att = by_target["att"]
    for p in att.predictors:
        assert p["sem_coefficient"] == pytest.approx(sem_coef[(p["id"], "att")])


def test_logistic_regression_reports_classification_metrics(tam_fit):
    model, fit, sem_coef = tam_fit
    targets = run_ml_comparison(model, fit.scores, sem_coef, ["linreg", "logreg"], k=3, seed=1)
    for tr in targets:
        logreg = tr.algorithms["logreg"]
        assert logreg.task == "classification"
        assert "accuracy" in logreg.metrics and "auc" in logreg.metrics
        assert "r2" not in logreg.metrics

        linreg = tr.algorithms["linreg"]
        assert linreg.task == "regression"
        assert "r2" in linreg.metrics and "rmse" in linreg.metrics
        assert "accuracy" not in linreg.metrics

        acc = logreg.metrics["accuracy"]
        assert acc is not None
        assert 0.0 <= acc["mean"] <= 1.0


def test_svm_has_no_native_importance_but_has_permutation_importance(tam_fit):
    model, fit, sem_coef = tam_fit
    targets = run_ml_comparison(model, fit.scores, sem_coef, ["svm"], k=3, seed=1)
    for tr in targets:
        svm = tr.algorithms["svm"]
        assert svm.native_importance is None
        assert all(v is not None for v in svm.permutation_importance.values())


def test_tree_based_native_importance_present(tam_fit):
    model, fit, sem_coef = tam_fit
    targets = run_ml_comparison(model, fit.scores, sem_coef, ["rf", "gbm"], k=3, seed=1)
    for tr in targets:
        for algo_id in ("rf", "gbm"):
            ao = tr.algorithms[algo_id]
            assert ao.native_importance is not None
            assert set(ao.native_importance.keys()) == {p["id"] for p in tr.predictors}


def test_unavailable_or_unknown_algorithm_rejected(tam_fit):
    model, fit, sem_coef = tam_fit
    with pytest.raises(ValueError):
        run_ml_comparison(model, fit.scores, sem_coef, ["not_a_real_algorithm"], k=3, seed=1)


def test_no_algorithms_selected_rejected(tam_fit):
    model, fit, sem_coef = tam_fit
    with pytest.raises(ValueError):
        run_ml_comparison(model, fit.scores, sem_coef, [], k=3, seed=1)


def test_budget_guard_rejects_excessive_configuration(tam_fit):
    model, fit, sem_coef = tam_fit
    # k isn't clamped at the engine layer (the route does that) -- a very
    # large k here is a stand-in for "any request whose estimated cost blows
    # the budget", regardless of exactly where that combination comes from.
    from ml_compare.engine import COST_PER_FIT_SECONDS
    n_targets = len(model.endogenous_ids())
    big_k = 100
    estimate = n_targets * big_k * sum(COST_PER_FIT_SECONDS[a] for a in ALGORITHM_ORDER)
    assert estimate > MAX_ESTIMATED_SECONDS  # sanity: this scenario really is over budget
    with pytest.raises(ValueError):
        run_ml_comparison(model, fit.scores, sem_coef, ALGORITHM_ORDER, k=big_k, seed=1)


def test_all_algorithms_run_successfully_on_full_algorithm_list(tam_fit):
    model, fit, sem_coef = tam_fit
    targets = run_ml_comparison(model, fit.scores, sem_coef, ALGORITHM_ORDER, k=2, seed=1)
    for tr in targets:
        assert set(tr.algorithms.keys()) == set(ALGORITHM_ORDER)
