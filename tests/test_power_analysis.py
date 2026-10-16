import numpy as np
import pytest

from pls.algorithm import run_pls_algorithm
from pls.model import Model
from pls.power_analysis import generate_synthetic_data, run_power_analysis


def _tam_population(model: Model, path_beta: float = 0.35, loading: float = 0.8):
    path_values = {(p.source, p.target): path_beta for p in model.paths}
    loading_values = {c.id: loading for c in model.constructs.values()}
    return path_values, loading_values


def test_generate_synthetic_data_recovers_population_parameters(tam_model_json):
    model = Model.from_json(tam_model_json)
    path_values, loading_values = _tam_population(model, path_beta=0.35, loading=0.8)
    rng = np.random.default_rng(1)
    df = generate_synthetic_data(model, path_values, loading_values, n=3000, rng=rng)

    assert set(df.columns) == set(model.all_indicators())
    result = run_pls_algorithm(model, df)
    assert result.converged

    # Tolerances are loose on purpose: PLS is a known-biased estimator (path
    # coefficients attenuated, reflective loadings inflated, e.g. Rönkkö et
    # al. 2016) even at large n with only 3 indicators per block — this test
    # checks the generator recovers the right ballpark/sign, not that PLS
    # itself is unbiased.
    for (src, tgt), beta in path_values.items():
        est = float(result.path_coefficients.loc[src, tgt])
        assert est == pytest.approx(beta, abs=0.1)
    for cid, construct in model.constructs.items():
        for ind in construct.indicators:
            assert float(result.outer_loadings[ind]) == pytest.approx(loading_values[cid], abs=0.1)


def test_power_increases_with_sample_size(tam_model_json):
    model = Model.from_json(tam_model_json)
    path_values, loading_values = _tam_population(model, path_beta=0.4, loading=0.8)
    points = run_power_analysis(
        model, path_values, loading_values, sample_sizes=[60, 400],
        n_mc=25, n_boot_inner=100, seed=3,
    )
    by_n = {}
    for p in points:
        by_n.setdefault(p.n, {})[(p.source, p.target)] = p.power

    for key in path_values:
        assert by_n[400][key] >= by_n[60][key]
    # a 0.4 population effect at n=400 should be reliably detected
    assert all(power >= 0.7 for power in by_n[400].values())


def test_rejects_moderation_models(moderation_model_json):
    model = Model.from_json(moderation_model_json)
    with pytest.raises(ValueError):
        run_power_analysis(model, {}, {}, [100], n_mc=20, n_boot_inner=100)


FORMATIVE_MODEL_JSON = {
    "constructs": [
        {"id": "x", "name": "X", "mode": "B", "indicators": ["X1", "X2", "X3"]},
        {"id": "m", "name": "M", "mode": "A", "indicators": ["M1", "M2", "M3"]},
        {"id": "y", "name": "Y", "mode": "B", "indicators": ["Y1", "Y2", "Y3", "Y4"]},
    ],
    "paths": [{"source": "x", "target": "m"}, {"source": "m", "target": "y"}],
}


def test_formative_block_is_an_exact_composite_with_requested_loadings():
    from pls.power_analysis import _formative_indicators

    rng = np.random.default_rng(5)
    eta = rng.standard_normal(100_000)
    for loading, k in [(0.7, 3), (0.4, 4), (0.9, 2)]:
        x = _formative_indicators(eta, loading, k, rng)
        np.testing.assert_allclose(x.var(axis=0), 1.0, atol=0.02)
        corr = [np.corrcoef(x[:, j], eta)[0, 1] for j in range(k)]
        np.testing.assert_allclose(corr, loading, atol=0.01)
        # the equally weighted composite reproduces the construct score exactly
        composite = x.sum(axis=1)
        np.testing.assert_allclose(composite / composite.std(), eta / eta.std(), atol=1e-8)
    single = _formative_indicators(eta, 0.5, 1, rng)
    np.testing.assert_array_equal(single[:, 0], eta)


def test_generate_synthetic_data_recovers_formative_population():
    model = Model.from_json(FORMATIVE_MODEL_JSON)
    path_values = {("x", "m"): 0.4, ("m", "y"): 0.3}
    loading_values = {"x": 0.7, "m": 0.8, "y": 0.6}
    df = generate_synthetic_data(model, path_values, loading_values, n=4000, rng=np.random.default_rng(2))
    result = run_pls_algorithm(model, df)
    assert result.converged
    for (src, tgt), beta in path_values.items():
        assert float(result.path_coefficients.loc[src, tgt]) == pytest.approx(beta, abs=0.08)
    for ind in ("X1", "X2", "X3"):
        assert float(result.outer_loadings[ind]) == pytest.approx(0.7, abs=0.08)


def test_power_analysis_runs_on_formative_constructs():
    model = Model.from_json(FORMATIVE_MODEL_JSON)
    points = run_power_analysis(
        model, {("x", "m"): 0.4, ("m", "y"): 0.4}, {"x": 0.7, "m": 0.8, "y": 0.7},
        sample_sizes=[60, 300], n_mc=20, n_boot_inner=100, seed=4,
    )
    by_n = {}
    for p in points:
        assert p.n_converged > 0
        by_n.setdefault(p.n, {})[(p.source, p.target)] = p.power
    assert all(power >= 0.7 for power in by_n[300].values())
    assert all(by_n[300][k] >= by_n[60][k] for k in by_n[300])


def test_rejects_missing_population_values(tam_model_json):
    model = Model.from_json(tam_model_json)
    with pytest.raises(ValueError):
        run_power_analysis(model, {}, {}, [100], n_mc=20, n_boot_inner=100)


def test_clamps_out_of_range_replicate_counts(tam_model_json):
    from pls.power_analysis import MAX_MC_REPLICATES, MIN_MC_REPLICATES

    model = Model.from_json(tam_model_json)
    path_values, loading_values = _tam_population(model)
    # n too small to even satisfy run_pls_algorithm's own minimum-observations
    # floor exercises the graceful "0 power, 0 converged" path rather than
    # raising, since a user's chosen range may legitimately dip below it.
    points = run_power_analysis(
        model, path_values, loading_values, sample_sizes=[5],
        n_mc=MIN_MC_REPLICATES - 10, n_boot_inner=MAX_MC_REPLICATES,
        seed=1,
    )
    assert all(p.power == 0.0 and p.n_converged == 0 for p in points)


def test_parallel_and_inline_runs_give_identical_results(tam_model_json, monkeypatch):
    """Every replicate has its own seed, so the process pool (pls/parallel.py)
    must reproduce the in-process run exactly, whatever the completion order."""
    model = Model.from_json(tam_model_json)
    path_values, loading_values = _tam_population(model, path_beta=0.3, loading=0.8)

    def run():
        return [(p.n, p.source, p.target, p.power, p.n_converged, p.mean_estimate) for p in run_power_analysis(
            model, path_values, loading_values, sample_sizes=[60, 120], n_mc=20, n_boot_inner=100, seed=11,
        )]

    monkeypatch.setenv("WEBSEM_WORKERS", "1")
    inline = run()
    monkeypatch.setenv("WEBSEM_WORKERS", "3")
    pooled = run()
    assert pooled == inline
