"""Data-calibrated populations for Monte Carlo power analysis.

The default power-analysis generator (`power_analysis.generate_synthetic_data`)
needs no data: the user declares path coefficients and loadings, exogenous
constructs are independent, and indicators are continuous. When a dataset has
been estimated, two data-calibrated populations are available instead
(Section 3.2 of the conclusion-stability workflow, reproducibility/):

- "calibrated": composite-model population. Within-block indicator
  correlations are the observed ones; between-block correlations are
  outer loadings x model-implied construct correlation, where exogenous
  constructs keep their observed correlations and endogenous constructs
  follow the fitted structural equations with independent errors.
- "saturated": the observed indicator correlation matrix itself, for paths
  whose predictors correlate more strongly than the structural model implies.

Either way, data are drawn from a multivariate normal distribution and each
indicator is mapped onto its observed marginal distribution (e.g. 7-point
categories) through a Gaussian copula whose latent correlation is calibrated
so that the discretized data reproduce the target correlation matrix.

This is a port of gen.py in the conclusion-stability-plssem package (v1.1.0)
that produced Table 5 of the paper; the arithmetic, iteration count and
calibration seed are the same, so both give the same population.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.stats import norm

from i18n import DEFAULT_LANG, t

from .algorithm import run_pls_algorithm
from .model import Model

POPULATIONS = ("model", "calibrated", "saturated")
CALIBRATION_ITERATIONS = 8
CALIBRATION_DRAWS = 150_000
CALIBRATION_SEED = 12345


def _nearest_correlation(S: np.ndarray, threshold: float, floor: float = 1e-6) -> np.ndarray:
    """Clips eigenvalues below `threshold` to `floor` and rescales to unit diagonal."""
    w, V = np.linalg.eigh(S)
    if w.min() >= threshold:
        return S
    w = np.clip(w, floor, None)
    S = V @ np.diag(w) @ V.T
    d = np.sqrt(np.diag(S))
    return S / np.outer(d, d)


def implied_construct_corr(model: Model, construct_ids: list[str], Rc: np.ndarray,
                           P: np.ndarray, r2: dict[str, float]) -> np.ndarray:
    """Model-implied construct correlations: exogenous correlations observed,
    endogenous constructs built from the structural equations with
    independent errors (P[t, s] = coefficient of s -> t)."""
    pos = {cid: i for i, cid in enumerate(construct_ids)}
    J = len(construct_ids)
    Sigma = np.zeros((J, J))
    exo = [pos[c] for c in construct_ids if not model.predecessors(c)]
    for a in exo:
        for b in exo:
            Sigma[a, b] = Rc[a, b]
    for cid in model.topological_order():
        preds = [pos[p] for p in model.predecessors(cid)]
        if not preds:
            continue
        tt = pos[cid]
        b = P[tt, preds]
        for j in range(J):
            if j != tt:
                Sigma[tt, j] = Sigma[j, tt] = float((b * Sigma[preds, j]).sum())
        Sigma[tt, tt] = float(b @ Sigma[np.ix_(preds, preds)] @ b + (1 - r2[cid]))
    return Sigma


@dataclass
class DataPopulation:
    """A picklable population: draw(rng, n) returns an n-row DataFrame of
    indicators on their observed scales."""
    indicators: list[str]
    target: np.ndarray          # K x K correlation the discretized data should reproduce
    latent_chol: np.ndarray     # Cholesky factor of the calibrated latent correlation
    cuts: list[tuple[np.ndarray, np.ndarray]]  # per indicator: (observed values, cumulative proportions)
    kind: str
    calibration_error: float

    def draw_array(self, rng: np.random.Generator, n: int, discretize: bool = True) -> np.ndarray:
        U = rng.standard_normal((n, len(self.indicators))) @ self.latent_chol.T
        if not discretize:
            return U
        X = np.empty_like(U)
        for k, (vals, cp) in enumerate(self.cuts):
            X[:, k] = vals[np.searchsorted(norm.ppf(cp), U[:, k])]
        return X

    def draw(self, rng: np.random.Generator, n: int) -> pd.DataFrame:
        return pd.DataFrame(self.draw_array(rng, n), columns=self.indicators)


def build_population(model: Model, df: pd.DataFrame, kind: str = "calibrated",
                     lang: str = DEFAULT_LANG) -> DataPopulation:
    """Fits the model to df and returns its calibrated or saturated population."""
    if kind not in ("calibrated", "saturated"):
        raise ValueError(t("err_power_bad_population", lang))
    if model.has_interactions():
        raise ValueError(t("err_power_no_interactions", lang))
    indicators = model.all_indicators()
    data = df[indicators].apply(pd.to_numeric, errors="coerce").dropna()
    X = data.to_numpy(float)
    result = run_pls_algorithm(model, data, lang=lang)

    Z = (X - X.mean(0)) / X.std(0, ddof=1)
    Sx = np.corrcoef(Z.T)
    if kind == "saturated":
        Sig = Sx.copy()
    else:
        construct_ids = list(model.constructs.keys())
        Rc = result.scores[construct_ids].corr().to_numpy()
        P = result.path_coefficients.loc[construct_ids, construct_ids].to_numpy().T
        Sc = implied_construct_corr(model, construct_ids, Rc, P, result.r_squared.to_dict())
        col = {ind: k for k, ind in enumerate(indicators)}
        L = result.cross_loadings
        Sig = np.zeros((len(indicators), len(indicators)))
        for a, ca in enumerate(construct_ids):
            ia = [col[i] for i in model.constructs[ca].indicators]
            for b, cb in enumerate(construct_ids):
                ib = [col[i] for i in model.constructs[cb].indicators]
                if a == b:
                    Sig[np.ix_(ia, ia)] = Sx[np.ix_(ia, ia)]  # composite model: within-block unrestricted
                else:
                    la = L.loc[model.constructs[ca].indicators, ca].to_numpy()
                    lb = L.loc[model.constructs[cb].indicators, cb].to_numpy()
                    Sig[np.ix_(ia, ib)] = np.outer(la, lb) * Sc[a, b]
        Sig = _nearest_correlation(Sig, 1e-8)

    cuts = []
    for k in range(X.shape[1]):
        vals, cnt = np.unique(X[:, k], return_counts=True)
        cuts.append((vals, (np.cumsum(cnt) / cnt.sum())[:-1]))

    pop = DataPopulation(indicators, Sig, np.linalg.cholesky(Sig), cuts, kind, float("nan"))
    lat = Sig.copy()
    rng = np.random.default_rng(CALIBRATION_SEED)
    for _ in range(CALIBRATION_ITERATIONS):
        emp = np.corrcoef(pop.draw_array(rng, CALIBRATION_DRAWS).T)
        lat = lat + 0.9 * (Sig - emp)
        np.fill_diagonal(lat, 1)
        lat = _nearest_correlation(lat, 1e-6)
        pop.latent_chol = np.linalg.cholesky(lat)
    pop.calibration_error = float(np.abs(np.corrcoef(pop.draw_array(rng, CALIBRATION_DRAWS).T) - Sig).max())
    return pop
