from pls.algorithm import run_pls_algorithm
from pls.metrics import (
    CMB_VIF_THRESHOLD,
    compute_all_metrics,
    full_collinearity_vif,
    htmt,
    rho_a,
)
from pls.model import Model


def test_rho_a_between_alpha_and_composite_reliability(tam_model_json, tam_df):
    # rho_A (Dijkstra-Henseler) should sit between Cronbach's alpha (lower
    # bound) and composite reliability (upper bound) for a well-behaved block
    # — this is the sanity check that first caught the wrong rho_A formula
    # during development (see CB-SEM/PLS-SEM commit history).
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    metrics = compute_all_metrics(result)
    for cid in model.constructs:
        alpha = metrics["cronbachs_alpha"][cid]
        rho = metrics["rho_a"][cid]
        cr = metrics["composite_reliability"][cid]
        assert alpha - 1e-6 <= rho <= cr + 1e-6


def test_htmt_diagonal_is_one(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    ht = htmt(model, result.scaled_data)
    for cid in model.constructs:
        assert abs(ht.loc[cid, cid] - 1.0) < 1e-9


def test_htmt_excludes_interaction_constructs(moderation_model_json, moderation_df):
    from pls.moderation import run_pls_with_moderation

    model = Model.from_json(moderation_model_json)
    result = run_pls_with_moderation(model, moderation_df)
    ht = htmt(model, result.scaled_data)
    assert "peou_x_exp" not in ht.index
    assert "peou_x_exp" not in ht.columns


def test_full_collinearity_vif_all_positive(tam_model_json, tam_df):
    model = Model.from_json(tam_model_json)
    result = run_pls_algorithm(model, tam_df)
    vif = full_collinearity_vif(result.scores)
    assert (vif > 0).all()
    assert CMB_VIF_THRESHOLD == 3.3
