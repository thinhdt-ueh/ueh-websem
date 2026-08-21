from cbsem.estimator import run_cbsem
from cbsem.metrics import compute_all_cbsem_metrics
from pls.model import Model


def test_cbsem_converges_on_tam_sample(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_cbsem(model, tam_df)
    assert result.converged
    assert result.n_obs == 250


def test_cbsem_fit_indices_present_and_plausible(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_cbsem(model, tam_df)
    fi = result.fit_indices
    for key in ("chi_square", "df", "cfi", "tli", "rmsea", "srmr"):
        assert key in fi
    assert 0.0 <= fi["cfi"] <= 1.0
    assert fi["rmsea"] >= 0.0


def test_cbsem_r_squared_generally_exceeds_pls(tam_model_json, tam_df):
    # documented property: ML corrects for measurement error, so CB-SEM R^2
    # is typically >= PLS-SEM's R^2 on the same data/model for at least some
    # endogenous constructs (not a hard guarantee for every single one).
    from pls.algorithm import run_pls_algorithm

    model = Model.from_json(tam_model_json)
    cb_result = run_cbsem(model, tam_df)
    pls_result = run_pls_algorithm(model, tam_df)
    higher = sum(
        1 for cid in model.endogenous_ids() if cb_result.r_squared[cid] >= pls_result.r_squared[cid] - 1e-6
    )
    assert higher >= 1


def test_cbsem_metrics_match_pls_metric_shapes(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_cbsem(model, tam_df)
    metrics = compute_all_cbsem_metrics(result)
    assert set(metrics) == {"cronbachs_alpha", "composite_reliability", "ave", "fornell_larcker", "htmt",
                             "full_collinearity_vif"}
