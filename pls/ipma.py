"""Importance-Performance Map Analysis (Ringle & Sarstedt 2016, "Gain more
insight from your PLS-SEM results: The importance-performance map
analysis") — for a chosen target construct, plots every antecedent
construct's:

  - IMPORTANCE: its TOTAL EFFECT (direct + indirect, standardized) on the
    target — reuses pls/effects.py's total_effects(), the same decomposition
    already shown in the app's mediation report.
  - PERFORMANCE: its average standing on a 0-100 scale, rescaling each of
    its indicators via (raw - min) / (max - min) * 100 using that
    indicator's OBSERVED min/max in the analyzed sample (not an assumed
    theoretical scale range, since the app doesn't collect one), then
    combining indicators with the construct's own outer weights — the same
    weights that build its composite score, just applied to the rescaled
    values instead of the standardized ones.

The combination flags constructs worth prioritizing: high importance but
low performance is the actionable quadrant (large effect on the outcome,
but respondents rate it poorly today); high importance + high performance
means "keep doing this"; low importance means it's not much of a lever
either way, regardless of current performance.

Reflective (Mode A) and formative (Mode B) antecedents are both supported
(both have outer weights); interaction/moderation constructs (mode "I") are
excluded — they have no indicators of their own, so "performance" isn't
defined for them.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .algorithm import PLSResult
from .effects import total_effects
from .model import Model


@dataclass
class IpmaRow:
    construct_id: str
    importance: float
    performance: float


def run_ipma(model: Model, result: PLSResult, target_id: str) -> list[IpmaRow]:
    if target_id not in model.constructs:
        raise ValueError(f"Unknown target construct: {target_id}")

    coef = {
        s: {t: float(result.path_coefficients.loc[s, t]) for t in result.path_coefficients.columns}
        for s in result.path_coefficients.index
    }
    effects_by_source = {
        e.source: e.total for e in total_effects(model, coef) if e.target == target_id
    }

    raw = result.data
    mins = raw.min()
    maxs = raw.max()
    span = (maxs - mins).replace(0, 1.0)
    rescaled = (raw - mins) / span * 100.0

    rows: list[IpmaRow] = []
    for cid, importance in effects_by_source.items():
        c = model.constructs[cid]
        if c.mode == "I" or not c.indicators:
            continue
        w = result.outer_weights[c.indicators].values
        w_sum = float(w.sum())
        if abs(w_sum) < 1e-9:
            continue
        performance = float(((rescaled[c.indicators].values @ w) / w_sum).mean())
        rows.append(IpmaRow(construct_id=cid, importance=round(importance, 6), performance=round(performance, 3)))
    return rows
