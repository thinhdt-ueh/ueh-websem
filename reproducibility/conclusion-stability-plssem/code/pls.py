"""Minimal PLS path modelling (Lohmöller / Wold) for the Oliveira model.
Path weighting scheme, Mode A / Mode B outer estimation, standardized data,
stop criterion 1e-7 on weight change, max 300 iterations.
"""
import json, os
import numpy as np

class Model:
    def __init__(self, spec):
        self.cons = [c['id'] for c in spec['constructs']]
        self.names = {c['id']: c['name'] for c in spec['constructs']}
        self.blocks = {c['id']: c['indicators'] for c in spec['constructs']}
        self.mode = {c['id']: c['mode'] for c in spec['constructs']}
        self.paths = [(p['source'], p['target']) for p in spec['paths']]
        self.ind = [i for c in self.cons for i in self.blocks[c]]
        self.J = len(self.cons); self.K = len(self.ind)
        self.cidx = {c: k for k, c in enumerate(self.cons)}
        self.iidx = {i: k for k, i in enumerate(self.ind)}
        # block membership matrix M (K x J)
        self.M = np.zeros((self.K, self.J))
        for c in self.cons:
            for i in self.blocks[c]:
                self.M[self.iidx[i], self.cidx[c]] = 1
        self.B = np.zeros((self.J, self.J))  # B[t, s] = 1 if s -> t
        for s, t in self.paths:
            self.B[self.cidx[t], self.cidx[s]] = 1
        self.adj = ((self.B + self.B.T) > 0).astype(float)
        self.endo = [c for c in self.cons if self.B[self.cidx[c]].sum() > 0]
        self.modeB = np.array([self.mode[c] == 'B' for c in self.cons])
        self.bslices = {c: [self.iidx[i] for i in self.blocks[c]] for c in self.cons}

def standardize(X):
    return (X - X.mean(0)) / X.std(0, ddof=1)

def fit(model, X, tol=1e-7, maxit=300):
    """X: n x K numpy array (raw). Returns dict with paths, weights, loadings, scores, R2, converged."""
    m = model
    Z = standardize(X)
    n = Z.shape[0]
    W = m.M.copy()  # initial weights 1
    Y = Z @ W
    Y = Y / Y.std(0, ddof=1)
    converged = False
    for it in range(maxit):
        R = (Y.T @ Y) / (n - 1)  # construct correlations
        # path weighting scheme
        E = np.zeros((m.J, m.J))
        for t in range(m.J):
            preds = np.where(m.B[t] > 0)[0]
            if len(preds):
                # regression of Y_t on predictors -> inner weights for predecessors
                Yp = Y[:, preds]
                b = np.linalg.lstsq(Yp, Y[:, t], rcond=None)[0]
                E[t, preds] = b
        for s in range(m.J):
            succ = np.where(m.B[:, s] > 0)[0]
            for t in succ:
                E[s, t] = R[s, t]
        Yin = Y @ E.T  # inner estimate of each construct: sum_j e_ij Y_j
        Yin = Yin / Yin.std(0, ddof=1)
        Wn = np.zeros_like(W)
        for j, c in enumerate(m.cons):
            idx = m.bslices[c]
            Xb = Z[:, idx]
            if m.modeB[j]:
                w = np.linalg.lstsq(Xb, Yin[:, j], rcond=None)[0]
            else:
                w = (Xb.T @ Yin[:, j]) / (n - 1)
            Wn[idx, j] = w
        Yn = Z @ Wn
        sd = Yn.std(0, ddof=1)
        Wn = Wn / sd
        Yn = Yn / sd
        delta = np.abs(Wn - W).max()
        W, Y = Wn, Yn
        if delta < tol:
            converged = True
            break
    # final: sign alignment (make sum of loadings positive per block)
    L = (Z.T @ Y) / (n - 1)  # K x J correlations
    for j, c in enumerate(m.cons):
        idx = m.bslices[c]
        if L[idx, j].sum() < 0:
            W[idx, j] *= -1; Y[:, j] *= -1
    L = (Z.T @ Y) / (n - 1)
    # structural
    P = np.zeros((m.J, m.J)); R2 = np.zeros(m.J)
    for t in range(m.J):
        preds = np.where(m.B[t] > 0)[0]
        if len(preds):
            b = np.linalg.lstsq(Y[:, preds], Y[:, t], rcond=None)[0]
            P[t, preds] = b
            yhat = Y[:, preds] @ b
            R2[t] = 1 - ((Y[:, t] - yhat) ** 2).sum() / ((Y[:, t] - Y[:, t].mean()) ** 2).sum()
    paths = np.array([P[m.cidx[t], m.cidx[s]] for s, t in m.paths])
    weights = np.array([W[m.iidx[i], m.cidx[c]] for c in m.cons for i in m.blocks[c]])
    loadings = np.array([L[m.iidx[i], m.cidx[c]] for c in m.cons for i in m.blocks[c]])
    return dict(paths=paths, weights=weights, loadings=loadings, scores=Y, R2=R2, P=P, W=W, L=L,
                converged=converged, iters=it + 1, Rc=(Y.T @ Y) / (n - 1))

def f2(model, res):
    """Cohen f2 for each path: (R2_incl - R2_excl)/(1-R2_incl)."""
    m = model; Y = res['scores']; out = []
    for s, t in m.paths:
        ti = m.cidx[t]; preds = list(np.where(m.B[ti] > 0)[0])
        r2i = res['R2'][ti]
        pe = [p for p in preds if p != m.cidx[s]]
        if pe:
            b = np.linalg.lstsq(Y[:, pe], Y[:, ti], rcond=None)[0]
            r2e = 1 - ((Y[:, ti] - Y[:, pe] @ b) ** 2).sum() / ((Y[:, ti] - Y[:, ti].mean()) ** 2).sum()
        else:
            r2e = 0
        out.append((r2i - r2e) / (1 - r2i))
    return np.array(out)

def rhoA(model, res, X):
    """Dijkstra-Henseler rho_A for reflective blocks."""
    m = model; Z = standardize(X); out = {}
    for j, c in enumerate(m.cons):
        if m.modeB[j]:
            out[c] = np.nan; continue
        idx = m.bslices[c]
        w = res["W"][idx, j]
        S = np.corrcoef(Z[:, idx].T)
        S0 = S - np.diag(np.diag(S))
        ww = np.outer(w, w); ww0 = ww - np.diag(np.diag(ww))
        out[c] = (w @ w) ** 2 * (w @ S0 @ w) / (w @ ww0 @ w)
    return out

def reliability(model, res):
    m = model; out = {}
    for j, c in enumerate(m.cons):
        if m.modeB[j]:
            continue
        l = res['L'][m.bslices[c], j]
        ave = (l ** 2).mean()
        cr = l.sum() ** 2 / (l.sum() ** 2 + (1 - l ** 2).sum())
        out[c] = dict(AVE=ave, CR=cr)
    return out

def bootstrap(model, X, B, rng, full=None):
    """Percentile bootstrap. Returns arrays of path estimates (B x P), weights (B x K), converged mask."""
    n = X.shape[0]
    est = np.full((B, len(model.paths)), np.nan)
    wts = np.full((B, model.K), np.nan)
    ok = np.zeros(B, bool)
    for b in range(B):
        idx = rng.integers(0, n, n)
        try:
            r = fit(model, X[idx])
        except Exception:
            continue
        if not r['converged']:
            continue
        est[b] = r['paths']; wts[b] = r['weights']; ok[b] = True
    return est, wts, ok

def summarize_boot(est_full, est_boot):
    """SE, z, two-sided p (t with df=B-1), percentile CI."""
    from scipy import stats
    e = est_boot[~np.isnan(est_boot).any(1)]
    B = e.shape[0]
    se = e.std(0, ddof=1)
    z = est_full / se
    p = 2 * stats.t.sf(np.abs(z), df=B - 1)
    lo, hi = np.percentile(e, [2.5, 97.5], axis=0)
    return dict(se=se, z=z, p=p, lo=lo, hi=hi, B=B)

def load():
    import pandas as pd
    spec = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'pls_model_oliveira2020.json')))
    m = Model(spec)
    df = pd.read_csv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'oliveira2020_data.csv'))
    X = df[m.ind].to_numpy(float)
    return m, X, df
