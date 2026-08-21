from pls.algorithm import run_pls_algorithm
from pls.bootstrap import MAX_BOOTSTRAP_SAMPLES, MIN_BOOTSTRAP_SAMPLES, run_bootstrap
from pls.model import Model


def test_bootstrap_produces_valid_samples(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    boot = run_bootstrap(model, result, n_boot=100, seed=42)
    assert boot.n_requested == 100
    assert boot.n_valid > 0
    assert len(boot.path_stats) == len(model.paths)


def test_bootstrap_clamps_out_of_range_n_boot(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    boot = run_bootstrap(model, result, n_boot=1, seed=1)
    assert boot.n_requested == MIN_BOOTSTRAP_SAMPLES
    boot2 = run_bootstrap(model, result, n_boot=999999, seed=1)
    assert boot2.n_requested == MAX_BOOTSTRAP_SAMPLES


def test_bootstrap_ci_contains_original_estimate_most_of_the_time(tam_model_json, tam_df):
    # not a hard guarantee for every path, but for a well-behaved model the
    # original point estimate should fall inside its own bootstrap CI
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    boot = run_bootstrap(model, result, n_boot=300, seed=7)
    inside = sum(
        1 for row in boot.path_stats
        if row["ci_lower"] is not None and row["ci_lower"] <= row["original"] <= row["ci_upper"]
    )
    assert inside >= len(boot.path_stats) - 1
