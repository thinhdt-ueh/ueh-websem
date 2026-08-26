import numpy as np
import pandas as pd
import pytest

from pls.algorithm import run_pls_algorithm
from pls.bootstrap import run_bootstrap_with_moderation
from pls.effects import find_moderated_mediation_opportunities, moderated_mediation_indices
from pls.model import Model
from pls.moderation import run_pls_with_moderation


def _first_stage_model_json():
    """x -> m (moderated by w) -> y: classic Hayes Model 7 shape."""
    return {
        "constructs": [
            {"id": "x", "name": "X", "mode": "A", "indicators": ["X1", "X2", "X3"]},
            {"id": "w", "name": "W", "mode": "A", "indicators": ["W1", "W2", "W3"]},
            {"id": "m", "name": "M", "mode": "A", "indicators": ["M1", "M2", "M3"]},
            {"id": "y", "name": "Y", "mode": "A", "indicators": ["Y1", "Y2", "Y3"]},
            {"id": "x_w", "name": "X x W", "mode": "I", "interaction_of": ["x", "w"],
             "calc_method": "two_stage", "product_term_generation": "standardized"},
        ],
        "paths": [
            {"source": "x", "target": "m"},
            {"source": "w", "target": "m"},
            {"source": "x_w", "target": "m"},
            {"source": "m", "target": "y"},
        ],
    }


def _second_stage_model_json():
    """x -> m -> y (moderated by w): classic Hayes Model 14 shape."""
    return {
        "constructs": [
            {"id": "x", "name": "X", "mode": "A", "indicators": ["X1", "X2", "X3"]},
            {"id": "w", "name": "W", "mode": "A", "indicators": ["W1", "W2", "W3"]},
            {"id": "m", "name": "M", "mode": "A", "indicators": ["M1", "M2", "M3"]},
            {"id": "y", "name": "Y", "mode": "A", "indicators": ["Y1", "Y2", "Y3"]},
            {"id": "m_w", "name": "M x W", "mode": "I", "interaction_of": ["m", "w"],
             "calc_method": "two_stage", "product_term_generation": "standardized"},
        ],
        "paths": [
            {"source": "x", "target": "m"},
            {"source": "m", "target": "y"},
            {"source": "w", "target": "y"},
            {"source": "m_w", "target": "y"},
        ],
    }


def _both_stage_model_json():
    """x -> m (moderated by w1) -> y (moderated by w2): both edges moderated."""
    return {
        "constructs": [
            {"id": "x", "name": "X", "mode": "A", "indicators": ["X1", "X2", "X3"]},
            {"id": "w1", "name": "W1", "mode": "A", "indicators": ["A1", "A2", "A3"]},
            {"id": "w2", "name": "W2", "mode": "A", "indicators": ["B1", "B2", "B3"]},
            {"id": "m", "name": "M", "mode": "A", "indicators": ["M1", "M2", "M3"]},
            {"id": "y", "name": "Y", "mode": "A", "indicators": ["Y1", "Y2", "Y3"]},
            {"id": "x_w1", "name": "X x W1", "mode": "I", "interaction_of": ["x", "w1"],
             "calc_method": "two_stage", "product_term_generation": "standardized"},
            {"id": "m_w2", "name": "M x W2", "mode": "I", "interaction_of": ["m", "w2"],
             "calc_method": "two_stage", "product_term_generation": "standardized"},
        ],
        "paths": [
            {"source": "x", "target": "m"},
            {"source": "w1", "target": "m"},
            {"source": "x_w1", "target": "m"},
            {"source": "m", "target": "y"},
            {"source": "w2", "target": "y"},
            {"source": "m_w2", "target": "y"},
        ],
    }


def _make_indicators(rng, latent, prefix, lam=0.85):
    n = len(latent)
    cols = {}
    for i in range(1, 4):
        noise = rng.standard_normal(n)
        cols[f"{prefix}{i}"] = lam * latent + np.sqrt(1 - lam**2) * noise
    return cols


def _first_stage_df(n=2000, a1=0.3, a2=0.2, a3=0.25, b=0.4, seed=42):
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(n)
    w = rng.standard_normal(n)
    disturbance_var = max(1 - a1**2 - a2**2 - a3**2, 0.3)
    m = a1 * x + a2 * w + a3 * (x * w) + rng.standard_normal(n) * np.sqrt(disturbance_var)
    y = b * m + rng.standard_normal(n) * np.sqrt(max(1 - b**2, 0.1))
    data = {}
    data.update(_make_indicators(rng, x, "X"))
    data.update(_make_indicators(rng, w, "W"))
    data.update(_make_indicators(rng, m, "M"))
    data.update(_make_indicators(rng, y, "Y"))
    return pd.DataFrame(data)


def _second_stage_df(n=2000, a=0.4, b1=0.3, b2=0.2, b3=0.25, seed=7):
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(n)
    w = rng.standard_normal(n)
    m = a * x + rng.standard_normal(n) * np.sqrt(max(1 - a**2, 0.1))
    disturbance_var = max(1 - b1**2 - b2**2 - b3**2, 0.3)
    y = b1 * m + b2 * w + b3 * (m * w) + rng.standard_normal(n) * np.sqrt(disturbance_var)
    data = {}
    data.update(_make_indicators(rng, x, "X"))
    data.update(_make_indicators(rng, w, "W"))
    data.update(_make_indicators(rng, m, "M"))
    data.update(_make_indicators(rng, y, "Y"))
    return pd.DataFrame(data)


def _coef_dict(result):
    return {
        s: {t: float(result.path_coefficients.loc[s, t]) for t in result.path_coefficients.columns}
        for s in result.path_coefficients.index
    }


def test_detects_first_stage_moderated_mediation():
    model = Model.from_json(_first_stage_model_json())
    opps = find_moderated_mediation_opportunities(model)
    assert len(opps) == 1
    opp = opps[0]
    assert opp.interaction_id == "x_w"
    assert opp.route[opp.moderated_index + 1:] == ["m", "y"]


def test_first_stage_index_recovers_population_value():
    a1, a2, a3, b = 0.3, 0.2, 0.25, 0.4
    model = Model.from_json(_first_stage_model_json())
    df = _first_stage_df(a1=a1, a2=a2, a3=a3, b=b)
    result = run_pls_with_moderation(model, df)
    assert result.converged
    rows = moderated_mediation_indices(model, _coef_dict(result))
    assert len(rows) == 1
    # a3 * b is the population index of moderated mediation (Hayes, 2015);
    # loose tolerance for PLS's known small-sample attenuation, same as
    # tests/test_power_analysis.py's equivalent recovery check.
    assert rows[0].index == pytest.approx(a3 * b, abs=0.03)


def test_detects_second_stage_moderated_mediation():
    model = Model.from_json(_second_stage_model_json())
    opps = find_moderated_mediation_opportunities(model)
    assert len(opps) == 1
    opp = opps[0]
    assert opp.interaction_id == "m_w"
    assert opp.route[:opp.moderated_index + 1] == ["x", "m"]


def test_second_stage_index_recovers_population_value():
    a, b1, b2, b3 = 0.4, 0.3, 0.2, 0.25
    model = Model.from_json(_second_stage_model_json())
    df = _second_stage_df(a=a, b1=b1, b2=b2, b3=b3)
    result = run_pls_with_moderation(model, df)
    assert result.converged
    rows = moderated_mediation_indices(model, _coef_dict(result))
    assert len(rows) == 1
    assert rows[0].index == pytest.approx(a * b3, abs=0.03)


def test_skips_both_stage_moderated_mediation():
    model = Model.from_json(_both_stage_model_json())
    assert find_moderated_mediation_opportunities(model) == []


def test_no_opportunities_for_plain_mediation(tam_model_json):
    model = Model.from_json(tam_model_json)
    assert find_moderated_mediation_opportunities(model) == []


def test_no_opportunities_for_simple_moderation_without_downstream_mediator(moderation_model_json):
    # peou_x_exp -> int with no further path out of int: moderation, but
    # nothing mediates it further, so there's no moderated *mediation*.
    model = Model.from_json(moderation_model_json)
    assert find_moderated_mediation_opportunities(model) == []


def test_bootstrap_reports_significant_index_for_a_strong_effect():
    model = Model.from_json(_first_stage_model_json())
    df = _first_stage_df(n=600, a1=0.3, a2=0.2, a3=0.35, b=0.4, seed=3)
    result = run_pls_with_moderation(model, df)
    assert result.converged
    boot = run_bootstrap_with_moderation(model, result, n_boot=200, seed=1)
    assert len(boot.moderated_mediation_stats) == 1
    row = boot.moderated_mediation_stats[0]
    assert row["interaction_id"] == "x_w"
    assert row["ci_lower"] is not None and row["ci_upper"] is not None
    assert row["p_value"] < 0.05
