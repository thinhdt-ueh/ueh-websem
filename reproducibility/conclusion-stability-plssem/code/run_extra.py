import numpy as np, json, time, os
from scipy.stats import norm
from pls import load, fit, standardize
from plsb import fit_batch, corr_weighted, boot_weights, boot_stats
from gen import Generator

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'results')
m, X, df = load(); n, K = X.shape
AS = [m.iidx[i] for i in m.blocks['as']]
res0 = fit(m, X); b0 = res0['paths']
def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)
out = {}

# ---------- A. bootstrap at N vs subsampling at 250
fb = np.load(f'{OUT}/full_boot.npz'); P = fb['paths'][fb['conv']]; W = fb['wts'][fb['conv']][:, AS]
d250 = np.load(f'{OUT}/sub_250.npz'); c = d250['conv']; E = d250['est'][c]; WS = d250['wAS'][c]
pairs = {'pjoy-am': (3, 4), 'inter-ident': (1, 0), 'spr-pr': (9, 7)}
A = {}
for k, (a, b) in pairs.items():
    db = P[:, a] - P[:, b]; ds = E[:, a] - E[:, b]
    A[k] = dict(boot_share_pos=float((db > 0).mean()), sub_share_pos=float((ds > 0).mean()), boot_sd=float(db.std()), sub_sd=float(ds.std()))
A['AS_small_w_neg_boot'] = (W[:, 1:] < 0).mean(0).tolist(); A['AS_small_w_neg_sub'] = (WS[:, 1:] < 0).mean(0).tolist()
A['AS_w_sd_boot'] = W.std(0).tolist(); A['AS_w_sd_sub'] = WS.std(0).tolist()
A['sign_share_boot'] = (np.sign(P) == np.sign(b0)).mean(0).tolist(); A['sign_share_sub'] = (np.sign(E) == np.sign(b0)).mean(0).tolist()
A['path_sd_boot'] = P.std(0).tolist(); A['path_sd_sub'] = E.std(0).tolist()
out['bootN_vs_sub'] = A; log('A done', json.dumps(A)[:400])

# ---------- B. BCa intervals (10,000 boots + jackknife)
Wj = np.ones((n, n)); np.fill_diagonal(Wj, 0)
rj = fit_batch(m, corr_weighted(X, Wj)); J = rj['paths']
def bca(theta, boots, jack, alpha=.05):
    z0 = norm.ppf((boots < theta).mean()); jm = jack.mean(); a = ((jm - jack) ** 3).sum() / (6 * (((jm - jack) ** 2).sum()) ** 1.5)
    def q(z): return norm.cdf(z0 + (z0 + z) / (1 - a * (z0 + z)))
    return float(np.percentile(boots, 100 * q(norm.ppf(alpha / 2)))), float(np.percentile(boots, 100 * q(norm.ppf(1 - alpha / 2))))
B = {}
for k in range(10):
    B[f'H{k+1}'] = bca(b0[k], P[:, k], J[:, k])
for k, (a, b) in pairs.items():
    B[k] = bca(b0[a] - b0[b], P[:, a] - P[:, b], J[:, a] - J[:, b])
out['bca'] = B; log('B done', B)

# ---------- C. independent samples from the OBSERVED indicator correlation matrix (saturated population)
class ObsGen(Generator):
    def __init__(self, m, res, X):
        self.m = m; Z = standardize(X); self.Sig = np.corrcoef(Z.T); self.Sc = None
        self.cuts = []
        for k in range(m.K):
            vals, cnt = np.unique(X[:, k], return_counts=True); cp = np.cumsum(cnt) / cnt.sum(); self.cuts.append((vals, cp[:-1]))
        self.Lat = self.Sig.copy(); self.Lc = np.linalg.cholesky(self.Lat); rng = np.random.default_rng(12345)
        for it in range(8):
            emp = np.corrcoef(self.draw(rng, 150000, True).T); self.Lat = self.Lat + 0.9 * (self.Sig - emp); np.fill_diagonal(self.Lat, 1)
            w, V = np.linalg.eigh(self.Lat)
            if w.min() < 1e-6:
                w = np.clip(w, 1e-6, None); self.Lat = V @ np.diag(w) @ V.T; d = np.sqrt(np.diag(self.Lat)); self.Lat = self.Lat / np.outer(d, d)
            self.Lc = np.linalg.cholesky(self.Lat)
        self.calib_err = float(np.abs(np.corrcoef(self.draw(rng, 150000, True).T) - self.Sig).max())
g = ObsGen(m, res0, X); log('obs generator calibrated', g.calib_err)
rl = fit(m, g.draw(np.random.default_rng(1), 200000)); log('large-sample paths', np.round(rl['paths'], 3), 'R2', np.round(rl['R2'][[m.cidx['pjoy'], m.cidx['as']]], 3))
rng = np.random.default_rng(778); R = 400; Bn = 500
pv = np.zeros((R, 10)); est = np.zeros((R, 10)); t = time.time()
for r in range(R):
    Xd = g.draw(rng, 250); Wc = np.vstack([np.ones((1, 250)), boot_weights(rng, 250, Bn)]); res = fit_batch(m, corr_weighted(Xd, Wc))
    est[r] = res['paths'][0]; pv[r] = boot_stats(res['paths'][0], res['paths'][1:], res['conv'][1:])[2]
    if (r + 1) % 100 == 0: log('obs indep', r + 1, round(time.time() - t))
out['indep_obs_250'] = dict(sig=(pv < .05).mean(0).tolist(), mean=est.mean(0).tolist(), sd=est.std(0).tolist(), R2_large=rl['R2'][[m.cidx['pjoy'], m.cidx['as']]].tolist(), calib_err=g.calib_err)
log('C done', np.round((pv < .05).mean(0), 2))
json.dump(out, open(f'{OUT}/extra.json', 'w'), indent=1)
