import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd

from cbsem.estimator import run_cbsem
from cbsem.metrics import compute_all_cbsem_metrics
from pls.model import Model

model_json = {
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

model = Model.from_json(model_json)
df = pd.read_csv("sample_data/tam_sample.csv")
result = run_cbsem(model, df)

print("converged:", result.converged, "message:", result.optimizer_message, "n_it:", result.n_iterations)
print("\nFit indices:")
for k, v in result.fit_indices.items():
    print(f"  {k}: {v:.4f}" if isinstance(v, float) else f"  {k}: {v}")

print("\nMeasurement model (loadings):")
print(result.measurement.round(3))

print("\nStructural model (paths):")
print(result.structural.round(3))

print("\nR^2:")
print(result.r_squared.round(3))

metrics = compute_all_cbsem_metrics(result)
print("\nCronbach's alpha:\n", metrics["cronbachs_alpha"].round(3))
print("\nComposite reliability:\n", metrics["composite_reliability"].round(3))
print("\nAVE:\n", metrics["ave"].round(3))
print("\nFornell-Larcker:\n", metrics["fornell_larcker"].round(3))
print("\nHTMT:\n", metrics["htmt"].round(3))
