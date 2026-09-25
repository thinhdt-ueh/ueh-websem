"""Regression coverage for the moderation feature, converting the manual
validation done during development (simulated data with a known, injected
interaction effect — see scripts/moderation_validation.py) into permanent
assertions instead of one-off eyeballed output.
"""

import numpy as np
import pandas as pd
import pytest

from pls.bootstrap import run_bootstrap_with_moderation
from pls.model import Model
from pls.moderation import run_pls_with_moderation

from .conftest import TRUE_INTERACTION_EFFECT

TRUE_THREE_WAY_EFFECT = 0.30


def _three_way_model_json():
    return {
        "constructs": [
            {"id": "peou", "name": "PEOU", "mode": "A", "indicators": ["PEOU1", "PEOU2", "PEOU3"]},
            {"id": "exp", "name": "Experience", "mode": "A", "indicators": ["EXP1", "EXP2", "EXP3"]},
            {"id": "nov", "name": "Novelty", "mode": "A", "indicators": ["NOV1", "NOV2", "NOV3"]},
            {"id": "int", "name": "Intention", "mode": "A", "indicators": ["INT1", "INT2", "INT3"]},
            {"id": "peou_x_exp_x_nov", "name": "PEOU x Experience x Novelty", "mode": "I",
             "interaction_of": ["peou", "exp", "nov"], "calc_method": "two_stage",
             "product_term_generation": "standardized"},
        ],
        "paths": [
            {"source": "peou", "target": "int"},
            {"source": "exp", "target": "int"},
            {"source": "nov", "target": "int"},
            {"source": "peou_x_exp_x_nov", "target": "int"},
        ],
    }


def _three_way_df():
    # Same construction convention as moderation_df (conftest.py), extended
    # with a third exogenous source and a genuine three-way product term
    # (peou*exp*nov) injected into the target's structural equation.
    rng = np.random.default_rng(11)
    n = 500
    peou = rng.normal(0, 1, n)
    exp = rng.normal(0, 1, n)
    nov = rng.normal(0, 1, n)
    intent = (
        0.25 * peou + 0.20 * exp + 0.15 * nov
        + TRUE_THREE_WAY_EFFECT * (peou * exp * nov)
        + rng.normal(0, 0.6, n)
    )

    def make_indicators(latent, loadings, prefix):
        cols = {}
        for i, lam in enumerate(loadings, start=1):
            noise_sd = np.sqrt(max(1 - lam**2, 0.05))
            raw = lam * latent + rng.normal(0, noise_sd, len(latent))
            cols[f"{prefix}{i}"] = np.clip(np.round(4 + raw * 1.15), 1, 7).astype(int)
        return cols

    data = {}
    data.update(make_indicators(peou, [0.85, 0.80, 0.78], "PEOU"))
    data.update(make_indicators(exp, [0.86, 0.82, 0.79], "EXP"))
    data.update(make_indicators(nov, [0.84, 0.81, 0.77], "NOV"))
    data.update(make_indicators(intent, [0.87, 0.84, 0.80], "INT"))
    return pd.DataFrame(data)


def test_three_way_interaction_recovers_injected_effect():
    model = Model.from_json(_three_way_model_json())
    result = run_pls_with_moderation(model, _three_way_df())
    assert result.converged
    coeff = result.path_coefficients.loc["peou_x_exp_x_nov", "int"]
    # Same attenuation caveat as the two-way case above -- sign recovered,
    # magnitude damped relative to the raw injected effect.
    assert coeff > 0.03
    assert coeff < TRUE_THREE_WAY_EFFECT + 0.2


def test_three_way_interaction_bootstraps_without_error():
    model = Model.from_json(_three_way_model_json())
    result = run_pls_with_moderation(model, _three_way_df())
    boot = run_bootstrap_with_moderation(model, result, n_boot=100, seed=2)
    row = next(r for r in boot.path_stats if r["source"] == "peou_x_exp_x_nov" and r["target"] == "int")
    assert row["original"] is not None
    assert row["p_value"] is not None


def test_cbsem_handles_three_way_interaction():
    from cbsem.moderation import run_cbsem_with_moderation

    model = Model.from_json(_three_way_model_json())
    result = run_cbsem_with_moderation(model, _three_way_df())
    assert result.converged
    row = result.structural[
        (result.structural["source"] == "peou_x_exp_x_nov") & (result.structural["target"] == "int")
    ].iloc[0]
    assert row["std"] != 0


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
