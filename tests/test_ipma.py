import pytest

from pls.algorithm import run_pls_algorithm
from pls.ipma import run_ipma
from pls.model import Model


def test_ipma_returns_every_antecedent(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    rows = run_ipma(model, result, "int")
    assert {r.construct_id for r in rows} == {"peou", "pu", "att"}


def test_ipma_performance_is_within_0_100(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    rows = run_ipma(model, result, "int")
    for r in rows:
        assert 0.0 <= r.performance <= 100.0


def test_ipma_rejects_unknown_target(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    with pytest.raises(ValueError):
        run_ipma(model, result, "not_a_real_construct")


def test_ipma_importance_matches_total_effects(tam_model_json, tam_df):
    from pls.effects import total_effects

    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    coef = {
        s: {t: float(result.path_coefficients.loc[s, t]) for t in result.path_coefficients.columns}
        for s in result.path_coefficients.index
    }
    expected = {e.source: e.total for e in total_effects(model, coef) if e.target == "int"}
    rows = {r.construct_id: r.importance for r in run_ipma(model, result, "int")}
    for cid, imp in rows.items():
        assert imp == pytest.approx(expected[cid], abs=1e-5)
