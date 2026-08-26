import numpy as np
import pytest

from cbsem.estimator import run_cbsem
from cbsem.power_analysis import run_power_analysis
from pls.model import Model
from pls.power_analysis import generate_synthetic_data


def _tam_population(model: Model, path_beta: float = 0.35, loading: float = 0.8):
    path_values = {(p.source, p.target): path_beta for p in model.paths}
    loading_values = {c.id: loading for c in model.constructs.values()}
    return path_values, loading_values


def test_generate_synthetic_data_recovers_population_parameters_under_cbsem(tam_model_json):
    model = Model.from_json(tam_model_json)
    path_values, loading_values = _tam_population(model, path_beta=0.35, loading=0.8)
    rng = np.random.default_rng(1)
    df = generate_synthetic_data(model, path_values, loading_values, n=3000, rng=rng)

    result = run_cbsem(model, df)
    assert result.converged

    # CB-SEM (Maximum Likelihood) corrects for measurement error, so
    # recovery should be tighter than PLS-SEM's own known attenuation bias
    # (see tests/test_power_analysis.py's equivalent test) — still loose on
    # purpose, this checks the shared generator produces sane data, not that
    # CB-SEM is a perfect estimator at this n.
    for (src, tgt), beta in path_values.items():
        row = result.structural[(result.structural.source == src) & (result.structural.target == tgt)].iloc[0]
        assert float(row["std"]) == pytest.approx(beta, abs=0.06)
    for cid, construct in model.constructs.items():
        for ind in construct.indicators:
            row = result.measurement.loc[ind]
            assert float(row["std"]) == pytest.approx(loading_values[cid], abs=0.06)


def test_power_increases_with_sample_size(tam_model_json):
    model = Model.from_json(tam_model_json)
    path_values, loading_values = _tam_population(model, path_beta=0.4, loading=0.8)
    points = run_power_analysis(
        model, path_values, loading_values, sample_sizes=[60, 300],
        n_mc=40, seed=3,
    )
    by_n = {}
    for p in points:
        by_n.setdefault(p.n, {})[(p.source, p.target)] = p.power

    for key in path_values:
        assert by_n[300][key] >= by_n[60][key]
    assert all(power >= 0.7 for power in by_n[300].values())


def test_rejects_moderation_models(moderation_model_json):
    model = Model.from_json(moderation_model_json)
    with pytest.raises(ValueError):
        run_power_analysis(model, {}, {}, [100], n_mc=20)


def test_rejects_non_reflective_constructs():
    model = Model.from_json({
        "constructs": [
            {"id": "x", "name": "X", "mode": "B", "indicators": ["X1", "X2"]},
            {"id": "y", "name": "Y", "mode": "A", "indicators": ["Y1", "Y2"]},
        ],
        "paths": [{"source": "x", "target": "y"}],
    })
    with pytest.raises(ValueError):
        run_power_analysis(model, {("x", "y"): 0.3}, {"x": 0.7, "y": 0.7}, [100], n_mc=20)


def test_rejects_missing_population_values(tam_model_json):
    model = Model.from_json(tam_model_json)
    with pytest.raises(ValueError):
        run_power_analysis(model, {}, {}, [100], n_mc=20)


def test_clamps_out_of_range_replicate_counts(tam_model_json):
    from pls.power_analysis import MIN_MC_REPLICATES

    model = Model.from_json(tam_model_json)
    path_values, loading_values = _tam_population(model)
    points = run_power_analysis(
        model, path_values, loading_values, sample_sizes=[5],
        n_mc=MIN_MC_REPLICATES - 10, seed=1,
    )
    assert all(p.power == 0.0 and p.n_converged == 0 for p in points)
