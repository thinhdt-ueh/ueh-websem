"""Core PLS-SEM estimation: the iterative PLS algorithm (path weighting scheme).

Implements the classic Lohmöller / Wold algorithm used by SmartPLS:
  1. Outer approximation of latent variable (LV) scores from standardized indicators.
  2. Inner approximation of LV scores using the "path weighting scheme".
  3. Re-estimation of outer weights (Mode A for reflective blocks, Mode B for
     formative blocks) against the inner proxy.
  4. Repeat until outer weights converge, then estimate the structural model
     (OLS regressions) on the final standardized LV scores.

The iterative core (`_fit`) works on plain NumPy arrays rather than pandas
objects: this function is the hot loop for bootstrapping (re-run hundreds to
thousands of times per analysis), and per-call pandas overhead (Series/
DataFrame construction, label alignment) dominates runtime at this data size
far more than the linear algebra itself.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from i18n import DEFAULT_LANG, t

from .model import Model


def _standardize(df: pd.DataFrame, lang: str = DEFAULT_LANG) -> pd.DataFrame:
    """Mean 0, population std (ddof=0) — matches SmartPLS' indicator standardization."""
    std = df.std(ddof=0)
    if (std == 0).any():
        zero_cols = list(std[std == 0].index)
        raise ValueError(t("err_zero_variance_indicators", lang, cols=", ".join(zero_cols)))
    return (df - df.mean()) / std


def _standardize_cols(A: np.ndarray) -> np.ndarray:
    std = A.std(axis=0, ddof=0)
    std = np.where(std == 0, 1.0, std)
    return (A - A.mean(axis=0)) / std


def _ols_beta(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Coefficients (incl. intercept as last column) via normal equations —
    faster than np.linalg.lstsq's SVD path for the tiny design matrices here."""
    X1 = np.column_stack([X, np.ones(X.shape[0])])
    XtX = X1.T @ X1
    Xty = X1.T @ y
    try:
        return np.linalg.solve(XtX, Xty)
    except np.linalg.LinAlgError:
        return np.linalg.lstsq(X1, y, rcond=None)[0]


@dataclass
class _Topology:
    construct_ids: list[str]
    block_idx: list[np.ndarray]  # per construct: column indices into the indicator matrix
    modes: list[str]
    pred_pos: list[list[int]]  # per construct: positions (in construct_ids) of predecessors
    succ_pos: list[list[int]]  # per construct: positions of successors


def _build_topology(model: Model, indicators: list[str]) -> _Topology:
    col_pos = {name: i for i, name in enumerate(indicators)}
    construct_ids = list(model.constructs.keys())
    cid_pos = {cid: i for i, cid in enumerate(construct_ids)}
    block_idx = [
        np.array([col_pos[ind] for ind in model.constructs[cid].indicators], dtype=int)
        for cid in construct_ids
    ]
    modes = [model.constructs[cid].mode for cid in construct_ids]
    pred_pos = [[cid_pos[p] for p in model.predecessors(cid)] for cid in construct_ids]
    succ_pos = [[cid_pos[s] for s in model.successors(cid)] for cid in construct_ids]
    return _Topology(construct_ids, block_idx, modes, pred_pos, succ_pos)


def _fit(X: np.ndarray, topo: _Topology, max_iterations: int, tolerance: float):
    """Runs the iterative PLS algorithm on standardized indicator matrix X (n x p).
    Returns (w, Y, n_iter, converged) where w is the flat (p,) outer weight vector
    and Y is the (n x k) matrix of final standardized latent variable scores.

    Every block's scores, Mode A weights and weight rescaling are computed
    together through a block-membership mask (one matrix product each instead
    of a Python loop over constructs) -- the same math, but this function runs
    once per bootstrap resample and once per Monte Carlo replicate, so the
    per-construct loop overhead dominated those runs."""
    n, p = X.shape
    k = len(topo.construct_ids)

    # mask[j, ci] == 1 when indicator j belongs to construct ci's block
    # (Model validation guarantees each indicator is in at most one block).
    mask = np.zeros((p, k))
    owner = np.full(p, -1)
    for ci, bi in enumerate(topo.block_idx):
        mask[bi, ci] = 1.0
        owner[bi] = ci
    in_block = owner >= 0
    mode_a = np.array([m == "A" for m in topo.modes])
    mode_a_ind = in_block & mode_a[np.where(in_block, owner, 0)]
    mode_b_blocks = [ci for ci in range(k) if not mode_a[ci] and len(topo.block_idx[ci])]

    w = mask.sum(axis=1)  # 1.0 for every indicator in a block

    def compute_scores(weights: np.ndarray) -> np.ndarray:
        return X @ (mask * weights[:, None])

    converged = False
    n_iter = 0

    for n_iter in range(1, max_iterations + 1):
        Y = _standardize_cols(compute_scores(w))

        # --- inner estimation: path weighting scheme ---
        # Each construct's inner proxy is a weighted sum of its neighbours'
        # scores: OLS betas for predecessors, correlations for successors.
        # Y is standardized, so both come from the k x k correlation matrix,
        # and all proxies are then one product Y @ E.
        R = (Y.T @ Y) / n
        E = np.zeros((k, k))
        for ci in range(k):
            preds = topo.pred_pos[ci]
            succs = topo.succ_pos[ci]
            if not preds and not succs:
                E[ci, ci] = 1.0
                continue
            if preds:
                E[preds, ci] = _ols_beta(Y[:, preds], Y[:, ci])[:-1]
            if succs:
                E[succs, ci] += R[ci, succs]
        Z = _standardize_cols(Y @ E)

        # --- outer estimation: Mode A (reflective) or Mode B (formative) ---
        new_w = np.zeros(p)
        # Mode A: covariance of each indicator with its own block's inner
        # proxy (Z is standardized => var == 1).
        cov = (X.T @ Z) / n
        new_w[mode_a_ind] = cov[mode_a_ind, owner[mode_a_ind]]
        for ci in mode_b_blocks:
            bi = topo.block_idx[ci]
            new_w[bi] = _ols_beta(X[:, bi], Z[:, ci])[:-1]
        # rescale every block so its score has unit variance
        sd = compute_scores(new_w).std(axis=0, ddof=0)
        scale = np.where(sd > 0, sd, 1.0)
        new_w = np.where(in_block, new_w / scale[np.where(in_block, owner, 0)], new_w)

        diff = float(np.abs(new_w - w).sum())
        w = new_w
        if diff < tolerance:
            converged = True
            break

    Y = _standardize_cols(compute_scores(w))
    return w, Y, n_iter, converged


def structural_regression(
    model: Model, scores: pd.DataFrame, construct_ids: list[str] | None = None,
) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """OLS regression of every endogenous construct on its direct predecessors,
    given already-computed (standardized) construct scores. Pulled out of
    `run_pls_algorithm` so the exact same structural-model math can be reused
    for two-stage moderation analysis (pls/moderation.py), where `scores`
    includes interaction-term columns alongside the ordinary construct scores.
    """
    if construct_ids is None:
        construct_ids = list(model.constructs.keys())
    path_coefficients = pd.DataFrame(0.0, index=construct_ids, columns=construct_ids)
    r_squared: dict[str, float] = {}
    r_squared_adj: dict[str, float] = {}
    for cid in construct_ids:
        preds = model.predecessors(cid)
        if not preds:
            continue
        A = scores[preds].values
        y = scores[cid].values
        beta = _ols_beta(A, y)
        for i, p in enumerate(preds):
            path_coefficients.loc[p, cid] = beta[i]
        yhat = np.column_stack([A, np.ones(len(A))]) @ beta
        ss_res = float(np.sum((y - yhat) ** 2))
        ss_tot = float(np.sum((y - y.mean()) ** 2))
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
        n_obs, kk = len(y), len(preds)
        r2_adj = 1 - (1 - r2) * (n_obs - 1) / (n_obs - kk - 1) if n_obs - kk - 1 > 0 else float("nan")
        r_squared[cid] = r2
        r_squared_adj[cid] = r2_adj
    return path_coefficients, pd.Series(r_squared), pd.Series(r_squared_adj)


@dataclass
class PLSResult:
    model: Model
    data: pd.DataFrame  # raw (unstandardized) indicator data actually used
    scaled_data: pd.DataFrame  # standardized indicator data
    outer_weights: pd.Series  # index: indicator name
    outer_loadings: pd.Series  # index: indicator name
    cross_loadings: pd.DataFrame  # index: indicator, columns: construct id
    scores: pd.DataFrame  # index: obs, columns: construct id (standardized LV scores)
    path_coefficients: pd.DataFrame  # index/columns: construct id, value = coeff source->target
    r_squared: pd.Series  # index: construct id (endogenous only)
    r_squared_adj: pd.Series
    iterations: int
    converged: bool


def run_pls_algorithm(
    model: Model,
    df: pd.DataFrame,
    max_iterations: int = 300,
    tolerance: float = 1e-7,
    lang: str = DEFAULT_LANG,
) -> PLSResult:
    indicators = model.all_indicators()
    missing = [c for c in indicators if c not in df.columns]
    if missing:
        raise ValueError(t("err_missing_indicator_columns", lang, cols=", ".join(missing)))

    data = df[indicators].apply(pd.to_numeric, errors="coerce")
    n_missing = int(data.isna().any(axis=1).sum())
    data = data.dropna()
    if len(data) < len(indicators) + 5:
        raise ValueError(t("err_insufficient_observations", lang, n=len(data), missing=n_missing))

    X_df = _standardize(data, lang=lang)
    X = X_df.values
    construct_ids = list(model.constructs.keys())
    topo = _build_topology(model, indicators)

    w, Y, n_iter, converged = _fit(X, topo, max_iterations, tolerance)

    # --- outer loadings & cross-loadings: correlation of each indicator with each construct score ---
    # X and Y are both standardized (mean 0, population variance 1), so their
    # correlation matrix reduces to a single matrix product divided by n.
    cross_np = (X.T @ Y) / X.shape[0]
    cross_loadings = pd.DataFrame(cross_np, index=indicators, columns=construct_ids)

    outer_loadings = pd.Series(
        {
            ind: cross_loadings.loc[ind, cid]
            for cid, c in model.constructs.items()
            for ind in c.indicators
        }
    )
    flat_weights = pd.Series(w, index=indicators)
    Y_df = pd.DataFrame(Y, index=data.index, columns=construct_ids)

    path_coefficients, r_squared, r_squared_adj = structural_regression(model, Y_df, construct_ids)

    return PLSResult(
        model=model,
        data=data,
        scaled_data=X_df,
        outer_weights=flat_weights,
        outer_loadings=outer_loadings,
        cross_loadings=cross_loadings,
        scores=Y_df,
        path_coefficients=path_coefficients,
        r_squared=r_squared,
        r_squared_adj=r_squared_adj,
        iterations=n_iter,
        converged=converged,
    )
