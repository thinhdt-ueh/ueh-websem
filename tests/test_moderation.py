"""Regression coverage for the moderation feature, converting the manual
validation done during development (simulated data with a known, injected
interaction effect — see scripts/moderation_validation.py) into permanent
assertions instead of one-off eyeballed output.
"""

import pytest

from pls.bootstrap import run_bootstrap_with_moderation
from pls.model import Model
from pls.moderation import run_pls_with_moderation

from .conftest import TRUE_INTERACTION_EFFECT


@pytest.mark.parametrize("calc_method,term_gen", [
    ("two_stage", "standardized"),
    ("product_indicator", "mean_centered"),
    ("orthogonalization", "mean_centered"),
])
def test_all_calc_methods_recover_the_injected_interaction(
    moderation_model_json, moderation_df, calc_method, term_gen,
):
    moderation_model_json["constructs"][-1]["calc_method"] = calc_method
    moderation_model_json["constructs"][-1]["product_term_generation"] = term_gen
    model = Model.from_json(moderation_model_json)
    result = run_pls_with_moderation(model, moderation_df)

    assert result.converged
    coeff = result.path_coefficients.loc["peou_x_exp", "int"]
    # sign must be recovered; magnitude is attenuated relative to the raw
    # injected effect (expected — see pls/moderation.py's module docstring)
    # but should stay clearly positive and non-trivial.
    assert coeff > 0.05
    assert coeff < TRUE_INTERACTION_EFFECT + 0.2


def test_product_indicator_unstandardized_is_inflated_by_multicollinearity(
    moderation_model_json, moderation_df,
):
    # Chin et al. (2003)'s documented reason mean-centering matters: without
    # it, the raw product term is highly collinear with the main effects and
    # the estimated interaction coefficient becomes unstable/inflated.
    moderation_model_json["constructs"][-1]["calc_method"] = "product_indicator"
    moderation_model_json["constructs"][-1]["product_term_generation"] = "unstandardized"
    model = Model.from_json(moderation_model_json)
    result_unstd = run_pls_with_moderation(model, moderation_df)

    moderation_model_json["constructs"][-1]["product_term_generation"] = "mean_centered"
    model2 = Model.from_json(moderation_model_json)
    result_centered = run_pls_with_moderation(model2, moderation_df)

    coeff_unstd = result_unstd.path_coefficients.loc["peou_x_exp", "int"]
    coeff_centered = result_centered.path_coefficients.loc["peou_x_exp", "int"]
    assert coeff_unstd > coeff_centered


def test_bootstrap_with_moderation_flags_interaction_as_significant(moderation_model_json, moderation_df):
    model = Model.from_json(moderation_model_json)
    result = run_pls_with_moderation(model, moderation_df)
    boot = run_bootstrap_with_moderation(model, result, n_boot=200, seed=1)
    row = next(r for r in boot.path_stats if r["source"] == "peou_x_exp" and r["target"] == "int")
    assert row["p_value"] is not None
    assert row["p_value"] < 0.05


def test_cbsem_moderation_ignores_non_two_stage_calc_method(moderation_model_json, moderation_df):
    # CB-SEM always treats every interaction as two-stage regardless of what
    # was configured (product-indicator methods are PLS-SEM-only).
    from cbsem.moderation import run_cbsem_with_moderation

    moderation_model_json["constructs"][-1]["calc_method"] = "product_indicator"
    model = Model.from_json(moderation_model_json)
    result = run_cbsem_with_moderation(model, moderation_df)
    assert result.converged
    row = result.structural[
        (result.structural["source"] == "peou_x_exp") & (result.structural["target"] == "int")
    ].iloc[0]
    assert row["std"] > 0
