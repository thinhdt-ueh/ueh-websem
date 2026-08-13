"""Generates a synthetic Technology Acceptance Model (TAM) dataset for demo purposes:
PEOU -> PU -> ATT -> INT, plus PEOU -> ATT and PU -> INT, each construct measured by
3 reflective 7-point Likert indicators.
"""

import os

import numpy as np
import pandas as pd

rng = np.random.default_rng(42)
n = 250

peou = rng.normal(0, 1, n)
pu = 0.5 * peou + rng.normal(0, np.sqrt(1 - 0.5**2), n)
att = 0.3 * peou + 0.4 * pu + rng.normal(0, np.sqrt(1 - (0.3**2 + 0.4**2 + 2 * 0.3 * 0.4 * 0.5)), n)
intent = 0.35 * pu + 0.45 * att + rng.normal(0, 0.6, n)


def make_indicators(latent, loadings, prefix):
    cols = {}
    for i, lam in enumerate(loadings, start=1):
        noise_sd = np.sqrt(max(1 - lam**2, 0.05))
        raw = lam * latent + rng.normal(0, noise_sd, len(latent))
        scaled = 4 + raw * 1.15
        likert = np.clip(np.round(scaled), 1, 7).astype(int)
        cols[f"{prefix}{i}"] = likert
    return cols


data = {}
data.update(make_indicators(peou, [0.85, 0.80, 0.78], "PEOU"))
data.update(make_indicators(pu, [0.88, 0.83, 0.81], "PU"))
data.update(make_indicators(att, [0.82, 0.86, 0.79], "ATT"))
data.update(make_indicators(intent, [0.87, 0.84, 0.80], "INT"))

df = pd.DataFrame(data)

out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sample_data")
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "tam_sample.csv")
df.to_csv(out_path, index=False)
print(f"Wrote {len(df)} rows to {out_path}")
