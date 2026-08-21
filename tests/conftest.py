"""Shared fixtures. Statistical fixtures reuse the same model definitions and
simulated-data methodology already validated by hand throughout development
(see scripts/moderation_validation.py) — turning that ad hoc verification
into permanent regression coverage instead of one-off manual checks.
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TAM_MODEL_JSON = {
    "constructs": [
        {"id": "peou", "name": "Perceived Ease of Use", "mode": "A", "indicators": ["PEOU1", "PEOU2", "PEOU3"]},
        {"id": "pu", "name": "Perceived Usefulness", "mode": "A", "indicators": ["PU1", "PU2", "PU3"]},
        {"id": "att", "name": "Attitude", "mode": "A", "indicators": ["ATT1", "ATT2", "ATT3"]},
        {"id": "int", "name": "Behavioral Intention", "mode": "A", "indicators": ["INT1", "INT2", "INT3"]},
    ],
    "paths": [
        {"source": "peou", "target": "pu"},
        {"source": "peou", "target": "att"},
        {"source": "pu", "target": "att"},
        {"source": "pu", "target": "int"},
        {"source": "att", "target": "int"},
    ],
}


@pytest.fixture
def tam_model_json():
    return TAM_MODEL_JSON


@pytest.fixture
def tam_df():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return pd.read_csv(os.path.join(base, "sample_data", "tam_sample.csv"))


TRUE_INTERACTION_EFFECT = 0.35


@pytest.fixture
def moderation_model_json():
    return {
        "constructs": [
            {"id": "peou", "name": "PEOU", "mode": "A", "indicators": ["PEOU1", "PEOU2", "PEOU3"]},
            {"id": "exp", "name": "Experience", "mode": "A", "indicators": ["EXP1", "EXP2", "EXP3"]},
            {"id": "pu", "name": "PU", "mode": "A", "indicators": ["PU1", "PU2", "PU3"]},
            {"id": "int", "name": "Intention", "mode": "A", "indicators": ["INT1", "INT2", "INT3"]},
            {"id": "peou_x_exp", "name": "PEOU x Experience", "mode": "I", "interaction_of": ["peou", "exp"],
             "calc_method": "two_stage", "product_term_generation": "standardized"},
        ],
        "paths": [
            {"source": "peou", "target": "pu"},
            {"source": "peou", "target": "int"},
            {"source": "exp", "target": "int"},
            {"source": "pu", "target": "int"},
            {"source": "peou_x_exp", "target": "int"},
        ],
    }


@pytest.fixture
def moderation_df():
    rng = np.random.default_rng(7)
    n = 400
    peou = rng.normal(0, 1, n)
    exp = rng.normal(0, 1, n)
    pu = 0.4 * peou + rng.normal(0, np.sqrt(1 - 0.4**2), n)
    intent = (
        0.25 * peou + 0.20 * exp + 0.30 * pu
        + TRUE_INTERACTION_EFFECT * (peou * exp)
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
    data.update(make_indicators(pu, [0.88, 0.83, 0.81], "PU"))
    data.update(make_indicators(intent, [0.87, 0.84, 0.80], "INT"))
    return pd.DataFrame(data)


@pytest.fixture
def app():
    from app import create_app
    application = create_app()
    application.config.update(TESTING=True)
    return application


@pytest.fixture
def client(app):
    return app.test_client()
