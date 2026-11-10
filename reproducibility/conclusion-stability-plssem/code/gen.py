import numpy as np
from pls import load, fit, standardize

def implied_construct_corr(m, res):
    """Model-implied construct correlation matrix: exogenous correlations observed,
    endogenous constructs built from the structural equations with independent errors."""
    J = m.J; Rc = res['Rc']; P = res['P']
    exo = [j for j in range(J) if m.B[j].sum() == 0]
    order = exo + [m.cidx[c] for c in m.endo]   # pjoy before as (as depends on pjoy)
    Sigma = np.zeros((J, J))
    for a in exo:
        for b in exo:
            Sigma[a, b] = Rc[a, b]
    for t in [m.cidx[c] for c in m.endo]:
        preds = np.where(m.B[t] > 0)[0]
        b = P[t, preds]
        for j in range(J):
            if j == t: continue
            Sigma[t, j] = Sigma[j, t] = (b * Sigma[preds, j]).sum()
        Sigma[t, t] = b @ Sigma[np.ix_(preds, preds)] @ b + (1 - res['R2'][t])
    return Sigma

def implied_indicator_corr(m, res, X):
    Sc = implied_construct_corr(m, res)
    K = m.K; Sig = np.zeros((K, K))
    lam = res['L']  # K x J correlations indicator-construct
    Z = standardize(X); Sx = np.corrcoef(Z.T)
    for a, ca in enumerate(m.cons):
        ia = m.bslices[ca]
        for b, cb in enumerate(m.cons):
            ib = m.bslices[cb]
            if a == b:
                Sig[np.ix_(ia, ia)] = Sx[np.ix_(ia, ia)]   # composite model: within-block unrestricted
            else:
                Sig[np.ix_(ia, ib)] = np.outer(lam[ia, a], lam[ib, b]) * Sc[a, b]
    # ensure PSD
    w, V = np.linalg.eigh(Sig)
    if w.min() < 1e-8:
        w = np.clip(w, 1e-6, None); Sig = V @ np.diag(w) @ V.T
        d = np.sqrt(np.diag(Sig)); Sig = Sig / np.outer(d, d)
    return Sig, Sc

class Generator:
    def __init__(self, m, res, X):
        self.m = m
        self.Sig, self.Sc = implied_indicator_corr(m, res, X)
        # empirical marginals: cumulative proportions of categories 1..7 per item
        self.cuts = []
        for k in range(m.K):
            vals, cnt = np.unique(X[:, k], return_counts=True)
            cp = np.cumsum(cnt) / cnt.sum()
            self.cuts.append((vals, cp[:-1]))
        # calibrate the latent correlation so that discretized data reproduce Sig (Gaussian copula)
        self.Lat = self.Sig.copy(); self.Lc = np.linalg.cholesky(self.Lat)
        rng = np.random.default_rng(12345)
        for it in range(8):
            Xs = self.draw(rng, 150000, True)
            emp = np.corrcoef(Xs.T)
            self.Lat = self.Lat + 0.9 * (self.Sig - emp)
            np.fill_diagonal(self.Lat, 1)
            w, V = np.linalg.eigh(self.Lat)
            if w.min() < 1e-6:
                w = np.clip(w, 1e-6, None); self.Lat = V @ np.diag(w) @ V.T
                d = np.sqrt(np.diag(self.Lat)); self.Lat = self.Lat / np.outer(d, d)
            self.Lc = np.linalg.cholesky(self.Lat)
        self.calib_err = np.abs(np.corrcoef(self.draw(rng, 150000, True).T) - self.Sig).max()

    def draw(self, rng, n, discretize=True):
        U = rng.standard_normal((n, self.m.K)) @ self.Lc.T
        if not discretize:
            return U
        X = np.empty_like(U)
        from scipy.stats import norm
        for k, (vals, cp) in enumerate(self.cuts):
            thr = norm.ppf(cp)
            X[:, k] = vals[np.searchsorted(thr, U[:, k])]
        return X

if __name__ == '__main__':
    m, X, df = load(); res = fit(m, X)
    g = Generator(m, res, X); print('calibration max abs err', round(g.calib_err, 4))
    rng = np.random.default_rng(0)
    for disc in (False, True):
        Xs = g.draw(rng, 200000, disc)
        r = fit(m, Xs)
        print('discretize', disc, 'paths', np.round(r['paths'], 3), 'R2', np.round(r['R2'][[m.cidx[c] for c in m.endo]], 3))
    print('observed  ', np.round(res['paths'], 3))
