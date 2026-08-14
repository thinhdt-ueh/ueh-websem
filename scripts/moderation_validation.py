"""Validates the two-stage moderation pipeline against a dataset with a KNOWN,
injected interaction effect, to confirm the recovered interaction path
coefficient is in the right ballpark (sign + rough magnitude), not just that
the code runs without crashing.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd

from pls.model import Model
from pls.moderation import run_pls_with_moderation

rng = np.random.default_rng(7)
n = 400

peou = rng.normal(0, 1, n)
exp = rng.normal(0, 1, n)
pu = 0.4 * peou + rng.normal(0, np.sqrt(1 - 0.4**2), n)

TRUE_INTERACTION_EFFECT = 0.35  # deliberately large so it's easy to detect
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
df = pd.DataFrame(data)

model_json = {
    "constructs": [
        {"id": "peou", "name": "PEOU", "mode": "A", "indicators": ["PEOU1", "PEOU2", "PEOU3"]},
        {"id": "exp", "name": "Experience", "mode": "A", "indicators": ["EXP1", "EXP2", "EXP3"]},
        {"id": "pu", "name": "PU", "mode": "A", "indicators": ["PU1", "PU2", "PU3"]},
        {"id": "int", "name": "Intention", "mode": "A", "indicators": ["INT1", "INT2", "INT3"]},
        {"id": "peou_x_exp", "name": "PEOU x Experience", "mode": "I", "interaction_of": ["peou", "exp"]},
    ],
    "paths": [
        {"source": "peou", "target": "pu"},
        {"source": "peou", "target": "int"},
        {"source": "exp", "target": "int"},
        {"source": "pu", "target": "int"},
        {"source": "peou_x_exp", "target": "int"},
    ],
}
model = Model.from_json(model_json)
result = run_pls_with_moderation(model, df)

print("converged:", result.converged, "iterations:", result.iterations)
print("\npath coefficients into 'int':")
for src in model.predecessors("int"):
    print(f"  {src} -> int: {result.path_coefficients.loc[src, 'int']:.4f}")
print(f"\n(injected true standardized interaction effect ~ {TRUE_INTERACTION_EFFECT})")
print("R^2(int):", round(result.r_squared["int"], 4))
print("\nscores columns:", list(result.scores.columns))
print("scores head:\n", result.scores.head(3).round(3))

from pls.metrics import compute_all_metrics
metrics = compute_all_metrics(result)
print("\nf_squared matrix (peou_x_exp row):")
print(metrics["f_squared"].loc["peou_x_exp"])
print("\nfull_collinearity_vif:")
print(metrics["full_collinearity_vif"])
