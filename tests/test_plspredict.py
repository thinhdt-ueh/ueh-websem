import pytest

from pls.model import Model
from pls.plspredict import run_plspredict


def test_plspredict_runs_and_covers_every_reflective_indicator(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_plspredict(model, tam_df, k=10, seed=1)
    expected_indicators = {
        ind for cid in model.endogenous_ids() for ind in model.constructs[cid].indicators
    }
    assert {p.indicator for p in result.predictions} == expected_indicators
    assert result.verdict in ("high", "medium", "low", "none")
    assert result.n_total == len(expected_indicators)


def test_plspredict_rmse_is_never_negative(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_plspredict(model, tam_df, k=10, seed=1)
    for p in result.predictions:
        assert p.pls_rmse >= 0
        assert p.lm_rmse >= 0
        assert p.pls_wins == (p.pls_rmse < p.lm_rmse)


def test_plspredict_rejects_moderation_models(moderation_model_json, moderation_df):
    model = Model.from_json(moderation_model_json)
    with pytest.raises(ValueError):
        run_plspredict(model, moderation_df)


def test_plspredict_is_deterministic_given_a_seed(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    r1 = run_plspredict(model, tam_df, k=10, seed=99)
    r2 = run_plspredict(model, tam_df, k=10, seed=99)
    for p1, p2 in zip(r1.predictions, r2.predictions):
        assert p1.pls_rmse == pytest.approx(p2.pls_rmse)
