import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd

from pls.algorithm import run_pls_algorithm
from pls.metrics import compute_all_metrics
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
df = pd.read_csv(os.path.join("sample_data", "tam_sample.csv"))
result = run_pls_algorithm(model, df)

print("converged:", result.converged, "iterations:", result.iterations)
print("\nOuter loadings:\n", result.outer_loadings.round(3))
print("\nPath coefficients (nonzero):")
for p in model.paths:
    print(f"  {p.source} -> {p.target}: {result.path_coefficients.loc[p.source, p.target]:.3f}")
print("\nR^2:\n", result.r_squared.round(3))

metrics = compute_all_metrics(result)
print("\nCronbach's alpha:\n", metrics["cronbachs_alpha"].round(3))
print("\nrho_A:\n", metrics["rho_a"].round(3))
print("\nComposite reliability:\n", metrics["composite_reliability"].round(3))
print("\nAVE:\n", metrics["ave"].round(3))
print("\nFornell-Larcker:\n", metrics["fornell_larcker"].round(3))
print("\nHTMT:\n", metrics["htmt"].round(3))
print("\nf^2:\n", metrics["f_squared"].round(3))
print("\nInner VIF:\n", metrics["inner_vif"].round(3))
