"""Blindfolding procedure and Stone-Geisser's Q² (cross-validated redundancy) —
mirrors SmartPLS' "Blindfolding" report.

Algorithm (matches the reference implementation in the semPLS R package,
`qSquared.sempls()` with `dlines=TRUE`, the row-wise omission SmartPLS itself
uses, and `total=FALSE`, i.e. predictions use direct structural paths):

For each endogenous *reflective* construct c, and for each of D blindfolding
rounds j = 0..D-1:
  1. Blank out rows j, j+D, j+2D, ... for every indicator in c's block only
     (all other data — including other constructs' indicators — stays intact).
  2. Replace the blanked cells with that column's mean over the remaining
     (non-blanked) rows — a documented, simpler alternative to semPLS' default
     pairwise-deletion handling, chosen here because it lets each round reuse
     the same vectorized PLS estimator as the rest of the app instead of a
     second NaN-aware code path.
  3. Re-run the full PLS algorithm on this partially-imputed dataset.
  4. For each blanked row, predict c's standardized LV score from *this
     round's* re-estimated path coefficients applied to its direct
     predecessors' scores (not the omitted construct's own — that would leak
     the very data being predicted), then map that back to each raw
     indicator via this round's loading and this round's column mean/std.
  5. Accumulate SSE (actual vs. predicted) and SSO (actual vs. the column
     mean used for imputation) over the blanked cells.

Q² = 1 − ΣSSE / ΣSSO, summed across all D rounds. Q² > 0 indicates the
structural model has predictive relevance for that construct.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .algorithm import run_pls_algorithm
from .model import Model

DEFAULT_OMISSION_DISTANCE = 7


@dataclass
class BlindfoldingResult:
    omission_distance: int
    q_squared: dict[str, float]  # construct id -> Q²
    skipped: dict[str, str]  # construct id -> reason not computed


def run_blindfolding(
    model: Model,
    original_data: pd.DataFrame,
    omission_distance: int = DEFAULT_OMISSION_DISTANCE,
) -> BlindfoldingResult:
    targets = [
        cid
        for cid in model.endogenous_ids()
        if model.constructs[cid].mode == "A"
    ]
    n = original_data.shape[0]
    D = max(2, int(omission_distance))

    q_squared: dict[str, float] = {}
    skipped: dict[str, str] = {}

    if D >= n:
        for cid in targets:
            skipped[cid] = "Không đủ quan sát so với omission distance."
        return BlindfoldingResult(D, q_squared, skipped)

    for cid in targets:
        block_cols = model.constructs[cid].indicators
        preds = model.predecessors(cid)
        if not preds:
            skipped[cid] = "Construct nội sinh nhưng không có predecessor (không nên xảy ra)."
            continue

        sse_total = 0.0
        sso_total = 0.0
        for j in range(D):
            blind_rows = original_data.index[j::D]
            if len(blind_rows) == 0:
                continue

            data_blind = original_data.copy()
            data_blind.loc[blind_rows, block_cols] = np.nan
            col_means = data_blind[block_cols].mean()
            data_imputed = data_blind.copy()
            data_imputed[block_cols] = data_imputed[block_cols].fillna(col_means)

            round_result = run_pls_algorithm(model, data_imputed)
            Y = round_result.scores

            pred_score = sum(
                round_result.path_coefficients.loc[p, cid] * Y[p] for p in preds
            )
            pred_score_blind = pred_score.loc[blind_rows]

            for col in block_cols:
                loading = round_result.outer_loadings[col]
                col_std = data_imputed[col].std(ddof=0)
                col_mean = col_means[col]
                predicted_raw = col_mean + loading * pred_score_blind * col_std
                actual_raw = original_data.loc[blind_rows, col]
                sse_total += float(((actual_raw.values - predicted_raw.values) ** 2).sum())
                sso_total += float(((actual_raw.values - col_mean) ** 2).sum())

        q_squared[cid] = 1 - sse_total / sso_total if sso_total > 0 else float("nan")

    non_reflective_endogenous = [
        cid for cid in model.endogenous_ids() if model.constructs[cid].mode != "A"
    ]
    for cid in non_reflective_endogenous:
        skipped[cid] = "Formative (Mode B) — Q² qua blindfolding chỉ áp dụng cho construct reflective."

    return BlindfoldingResult(D, q_squared, skipped)
