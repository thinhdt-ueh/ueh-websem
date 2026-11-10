"""Batched PLS path modelling from indicator correlation matrices S (B x K x K).
Same algorithm as pls.fit (path weighting, Mode A/B, tol 1e-7, maxit 300)."""
import numpy as np
from pls import Model, load, standardize

def corr_batch(X, idx):
    """X: n x K raw; idx: B x m index array -> B x K x K correlation matrices."""
    Xi = X[idx]                     # B x m x K
    Xi = Xi - Xi.mean(1, keepdims=True)
    sd = Xi.std(1, ddof=1, keepdims=True)
    Xi = Xi / sd
    m = idx.shape[1]
    return (np.swapaxes(Xi, 1, 2) @ Xi) / (m - 1)

def fit_batch(model, S, tol=1e-7, maxit=300):
    m = model; B, K, _ = S.shape; J = m.J
    endo = [t for t in range(J) if m.B[t].sum() > 0]
    preds = {t: np.where(m.B[t] > 0)[0] for t in endo}
    succ = {s: np.where(m.B[:, s] > 0)[0] for s in range(J)}
    W = np.broadcast_to(m.M, (B, K, J)).copy()
    # normalize initial
    v = np.einsum('bkj,bkj->bj', S @ W, W)
    W = W / np.sqrt(v)[:, None, :]
    conv = np.zeros(B, bool); active = np.ones(B, bool)
    for it in range(maxit):
        Sa = S[active]; Wa = W[active]; Ba = Sa.shape[0]
        R = np.swapaxes(Wa,1,2) @ Sa @ Wa
        E = np.zeros((Ba, J, J))
        for t in endo:
            p = preds[t]
            Rpp = R[:, p][:, :, p]; Rpt = R[:, p, t]
            E[:, t, p] = np.linalg.solve(Rpp, Rpt[..., None])[..., 0]
        for s in range(J):
            for t in succ[s]:
                E[:, s, t] = R[:, s, t]
        # cov(Z, Yin) = S W E^T ; var(Yin) = diag(E R E^T)
        C = Sa @ Wa @ np.swapaxes(E,1,2)      # B x K x J
        vin = np.einsum('bjm,bjm->bj', E @ R, E)        # B x J
        C = C / np.sqrt(vin)[:, None, :]
        Wn = np.zeros_like(Wa)
        for j, c in enumerate(m.cons):
            idx = m.bslices[c]
            if m.modeB[j]:
                Sbb = Sa[:, idx][:, :, idx]
                Wn[:, idx, j] = np.linalg.solve(Sbb, C[:, idx, j][..., None])[..., 0]
            else:
                Wn[:, idx, j] = C[:, idx, j]
        v = np.einsum('bkj,bkj->bj', Sa @ Wn, Wn)
        Wn = Wn / np.sqrt(v)[:, None, :]
        delta = np.abs(Wn - Wa).reshape(Ba, -1).max(1)
        W[active] = Wn
        done = delta < tol
        ai = np.where(active)[0]
        conv[ai[done]] = True
        active[ai[done]] = False
        if not active.any():
            break
    # sign alignment
    L = S @ W
    for j, c in enumerate(m.cons):
        idx = m.bslices[c]
        sgn = np.sign(L[:, idx, j].sum(1)); sgn[sgn == 0] = 1
        W[:, idx, j] *= sgn[:, None]
    L = S @ W
    R = np.swapaxes(W,1,2) @ S @ W
    P = np.zeros((B, J, J)); R2 = np.zeros((B, J))
    for t in endo:
        p = preds[t]
        b = np.linalg.solve(R[:, p][:, :, p], R[:, p, t][..., None])[..., 0]
        P[:, t, p] = b
        R2[:, t] = (b * R[:, p, t]).sum(1)
    paths = np.stack([P[:, m.cidx[t], m.cidx[s]] for s, t in m.paths], 1)
    weights = np.stack([W[:, m.iidx[i], m.cidx[c]] for c in m.cons for i in m.blocks[c]], 1)
    loadings = np.stack([L[:, m.iidx[i], m.cidx[c]] for c in m.cons for i in m.blocks[c]], 1)
    return dict(paths=paths, weights=weights, loadings=loadings, R2=R2, Rc=R, W=W, L=L, conv=conv)

def rhoA_batch(model, res, S):
    m = model; out = {}
    for j, c in enumerate(m.cons):
        if m.modeB[j]:
            continue
        idx = m.bslices[c]
        w = res['W'][:, idx, j]
        Sb = S[:, idx][:, :, idx]
        S0 = Sb - np.einsum('bij,ij->bij', Sb, np.eye(len(idx)))
        ww = np.einsum('bi,bj->bij', w, w)
        ww0 = ww - np.einsum('bij,ij->bij', ww, np.eye(len(idx)))
        num = (np.einsum('bi,bi->b', w, w)) ** 2 * np.einsum('bi,bij,bj->b', w, S0, w)
        den = np.einsum('bi,bij,bj->b', w, ww0, w)
        out[c] = num / den
    return out

def boot_stats(est, boots, conv):
    """est: (P,) full estimates; boots: (B,P); conv: (B,) -> se, z, p, lo, hi."""
    from scipy import stats
    e = boots[conv]
    Bn = e.shape[0]
    se = e.std(0, ddof=1)
    z = est / se
    p = 2 * stats.t.sf(np.abs(z), df=Bn - 1)
    lo, hi = np.percentile(e, [2.5, 97.5], axis=0)
    return se, z, p, lo, hi, Bn

def corr_weighted(X, Wc):
    """X: n x K raw; Wc: B x n nonnegative weights (counts or 0/1). -> B x K x K correlations."""
    n, K = X.shape
    XX = (X[:, :, None] * X[:, None, :]).reshape(n, K * K)
    m = Wc.sum(1)                                   # B
    Sraw = (Wc @ XX).reshape(-1, K, K) / m[:, None, None]
    mu = (Wc @ X) / m[:, None]                      # B x K
    cov = Sraw - mu[:, :, None] * mu[:, None, :]
    sd = np.sqrt(np.einsum('bkk->bk', cov))
    return cov / (sd[:, :, None] * sd[:, None, :])

def boot_weights(rng, n, B):
    """Multinomial counts for B bootstrap resamples of size n."""
    return rng.multinomial(n, np.full(n, 1 / n), size=B).astype(float)
