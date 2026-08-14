"""Reliability, convergent- and discriminant-validity, and collinearity diagnostics
computed on top of a fitted PLSResult — mirrors SmartPLS' "Quality Criteria" reports.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .algorithm import PLSResult
from .model import Model


def cronbachs_alpha(model: Model, X: pd.DataFrame) -> pd.Series:
    out = {}
    for cid, c in model.constructs.items():
        if c.mode != "A" or len(c.indicators) < 2:
            continue
        block = X[c.indicators]
        k = block.shape[1]
        S = block.cov(ddof=1)
        item_var_sum = np.trace(S.values)
        total_var = S.values.sum()
        alpha = (k / (k - 1)) * (1 - item_var_sum / total_var) if total_var > 0 else float("nan")
        out[cid] = alpha
    return pd.Series(out)


def rho_a(model: Model, X: pd.DataFrame, weights: pd.Series) -> pd.Series:
    """Dijkstra-Henseler's rho_A (consistent reliability coefficient).

    rho_A = (w'w)^2 * [w'(S - diag(S))w] / [w'(ww' - diag(ww'))w]

    where S is the indicator correlation matrix and w the Mode A outer weights
    (Dijkstra & Henseler 2015, "Consistent Partial Least Squares Path Modeling";
    matches cSEM's rhoA / rho_C_weighted_mm implementation).
    """
    out = {}
    for cid, c in model.constructs.items():
        if c.mode != "A" or len(c.indicators) < 2:
            continue
        block = X[c.indicators]
        S = block.corr().values
        w = weights[c.indicators].values
        S_off = S - np.diag(np.diag(S))
        ww = np.outer(w, w)
        ww_off = ww - np.diag(np.diag(ww))
        numerator = float(w @ S_off @ w)
        denominator = float(w @ ww_off @ w)
        rho = (float(w @ w) ** 2) * numerator / denominator if denominator != 0 else float("nan")
        out[cid] = rho
    return pd.Series(out)


def composite_reliability(model: Model, loadings: pd.Series) -> pd.Series:
    """rho_c (Jöreskog's composite reliability)."""
    out = {}
    for cid, c in model.constructs.items():
        if c.mode != "A" or len(c.indicators) < 2:
            continue
        lam = loadings[c.indicators].values.astype(float)
        num = lam.sum() ** 2
        den = num + (1 - lam**2).sum()
        out[cid] = num / den if den > 0 else float("nan")
    return pd.Series(out)


def ave(model: Model, loadings: pd.Series) -> pd.Series:
    out = {}
    for cid, c in model.constructs.items():
        if c.mode != "A":
            continue
        lam = loadings[c.indicators].values.astype(float)
        out[cid] = float((lam**2).mean())
    return pd.Series(out)


def fornell_larcker(model: Model, scores: pd.DataFrame, ave_series: pd.Series) -> pd.DataFrame:
    ids = [cid for cid in model.constructs if cid in ave_series.index]
    corr = scores[ids].corr()
    table = corr.copy()
    for cid in ids:
        table.loc[cid, cid] = np.sqrt(ave_series[cid])
    return table


def htmt(model: Model, X: pd.DataFrame) -> pd.DataFrame:
    ids = list(model.constructs.keys())
    result = pd.DataFrame(index=ids, columns=ids, dtype=float)
    R = X.corr().abs()

    monotrait: dict[str, float] = {}
    for cid, c in model.constructs.items():
        inds = c.indicators
        if len(inds) < 2:
            monotrait[cid] = float("nan")
            continue
        sub = R.loc[inds, inds].values
        iu = np.triu_indices_from(sub, k=1)
        monotrait[cid] = float(sub[iu].mean())

    for i, cid_i in enumerate(ids):
        for cid_j in ids:
            if cid_i == cid_j:
                result.loc[cid_i, cid_j] = 1.0
                continue
            inds_i = model.constructs[cid_i].indicators
            inds_j = model.constructs[cid_j].indicators
            hetero = R.loc[inds_i, inds_j].values.mean()
            denom = np.sqrt(monotrait[cid_i] * monotrait[cid_j])
            result.loc[cid_i, cid_j] = hetero / denom if denom > 0 else float("nan")
    return result


def f_squared(model: Model, scores: pd.DataFrame) -> pd.DataFrame:
    """f^2 effect size for every structural path: how much R^2 of the target drops
    when a given predictor is removed."""
    ids = list(model.constructs.keys())
    out = pd.DataFrame(index=ids, columns=ids, dtype=float)

    def r2_of(target: str, preds: list[str]) -> float:
        if not preds:
            return 0.0
        y = scores[target].values
        A = scores[preds].values
        A1 = np.column_stack([A, np.ones(len(A))])
        beta, *_ = np.linalg.lstsq(A1, y, rcond=None)
        yhat = A1 @ beta
        ss_res = float(np.sum((y - yhat) ** 2))
        ss_tot = float(np.sum((y - y.mean()) ** 2))
        return 1 - ss_res / ss_tot if ss_tot > 0 else 0.0

    for target in ids:
        preds = model.predecessors(target)
        if not preds:
            continue
        r2_full = r2_of(target, preds)
        for p in preds:
            reduced = [x for x in preds if x != p]
            r2_reduced = r2_of(target, reduced)
            denom = 1 - r2_full
            out.loc[p, target] = (r2_full - r2_reduced) / denom if denom > 1e-9 else float("nan")
    return out


def _vif_within_set(df: pd.DataFrame, cols: list[str]) -> dict[str, float]:
    out = {}
    for col in cols:
        others = [c for c in cols if c != col]
        if not others:
            out[col] = float("nan")
            continue
        y = df[col].values
        A = df[others].values
        A1 = np.column_stack([A, np.ones(len(A))])
        beta, *_ = np.linalg.lstsq(A1, y, rcond=None)
        yhat = A1 @ beta
        ss_res = float(np.sum((y - yhat) ** 2))
        ss_tot = float(np.sum((y - y.mean()) ** 2))
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
        out[col] = 1 / (1 - r2) if r2 < 1 else float("inf")
    return out


def inner_vif(model: Model, scores: pd.DataFrame) -> pd.DataFrame:
    """Collinearity among predictors of each endogenous construct."""
    ids = list(model.constructs.keys())
    out = pd.DataFrame(index=ids, columns=ids, dtype=float)
    for target in ids:
        preds = model.predecessors(target)
        if len(preds) < 2:
            continue
        vifs = _vif_within_set(scores, preds)
        for p, v in vifs.items():
            out.loc[p, target] = v
    return out


def outer_vif(model: Model, X: pd.DataFrame) -> pd.Series:
    """Collinearity among indicators of formative (Mode B) blocks."""
    out = {}
    for cid, c in model.constructs.items():
        if c.mode != "B" or len(c.indicators) < 2:
            continue
        vifs = _vif_within_set(X, c.indicators)
        out.update(vifs)
    return pd.Series(out)


CMB_VIF_THRESHOLD = 3.3


def full_collinearity_vif(scores: pd.DataFrame) -> pd.Series:
    """Full collinearity test for common method bias (Kock, 2015) — the
    technique WarpPLS popularized for CMB assessment.

    Unlike `inner_vif` (which only checks collinearity among a target's own
    structural predecessors), here EVERY construct is regressed on ALL other
    constructs in the model regardless of the specified structural paths —
    a full/saturated regression used purely as a collinearity diagnostic. If
    every resulting VIF is <= 3.3, the model is considered free of common
    method bias; a single latent "method" factor inflating every construct's
    variance would otherwise show up as elevated collinearity across the board.
    Needs >= 3 constructs to be a meaningful multi-predictor collinearity
    check (with exactly 2, it reduces to a simple pairwise VIF).
    """
    cols = list(scores.columns)
    return pd.Series(_vif_within_set(scores, cols))


def compute_all_metrics(result: PLSResult) -> dict:
    model = result.model
    X = result.scaled_data
    alpha = cronbachs_alpha(model, X)
    rhoA = rho_a(model, X, result.outer_weights)
    cr = composite_reliability(model, result.outer_loadings)
    ave_s = ave(model, result.outer_loadings)
    fl = fornell_larcker(model, result.scores, ave_s)
    ht = htmt(model, X)
    f2 = f_squared(model, result.scores)
    ivif = inner_vif(model, result.scores)
    ovif = outer_vif(model, X)
    fcvif = full_collinearity_vif(result.scores)

    return {
        "cronbachs_alpha": alpha,
        "rho_a": rhoA,
        "composite_reliability": cr,
        "ave": ave_s,
        "fornell_larcker": fl,
        "htmt": ht,
        "f_squared": f2,
        "inner_vif": ivif,
        "outer_vif": ovif,
        "full_collinearity_vif": fcvif,
    }
