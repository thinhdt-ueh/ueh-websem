import numpy as np, time, json, os, sys
from pls import load, fit, f2, rhoA, reliability, standardize
from plsb import fit_batch, corr_weighted, boot_weights, rhoA_batch, boot_stats
from gen import Generator

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'results'); os.makedirs(OUT, exist_ok=True)
m, X, df = load(); n, K = X.shape
AS = [m.iidx[i] for i in m.blocks['as']]
COMP = m.cidx['comp']; ER = m.cidx['er']
def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)

def fit_with_boot(Xd, rng, B):
    """Fit dataset Xd and B bootstrap resamples in one batch. Returns res (index 0 = point estimate)."""
    nd = Xd.shape[0]
    Wc = np.vstack([np.ones((1, nd)), boot_weights(rng, nd, B)])
    S = corr_weighted(Xd, Wc)
    return fit_batch(m, S), S

stage = sys.argv[1] if len(sys.argv) > 1 else 'all'

# ---------------------------------------------------------------- Stage 1: full sample, 10,000 bootstraps
if stage in ('all', 'full'):
    rng = np.random.default_rng(20261020)
    res = fit(m, X)
    B = 10000; paths = np.zeros((B, 10)); wts = np.zeros((B, K)); conv = np.zeros(B, bool); R2b = np.zeros((B, m.J))
    t = time.time()
    for c in range(0, B, 2000):
        Wc = boot_weights(rng, n, 2000); r = fit_batch(m, corr_weighted(X, Wc))
        paths[c:c+2000] = r['paths']; wts[c:c+2000] = r['weights']; conv[c:c+2000] = r['conv']; R2b[c:c+2000] = r['R2']
    log('full bootstrap done', round(time.time()-t, 1), 's conv', conv.sum())
    se, z, p, lo, hi, Bn = boot_stats(res['paths'], paths, conv)
    wse, wz, wp, wlo, whi, _ = boot_stats(res['weights'], wts, conv)
    # pairwise differences
    pairs = {'pjoy-am': (3, 4), 'inter-ident': (1, 0), 'spr-pr': (9, 7), 'pjoy-pf': (3, 5), 'am-pf': (4, 5)}
    diffs = {}
    for k, (a, b) in pairs.items():
        d = paths[conv, a] - paths[conv, b]; est = res['paths'][a] - res['paths'][b]
        diffs[k] = dict(est=float(est), se=float(d.std(ddof=1)), lo=float(np.percentile(d, 2.5)), hi=float(np.percentile(d, 97.5)),
                        p=float(2 * __import__('scipy').stats.t.sf(abs(est / d.std(ddof=1)), df=Bn - 1)), share_pos=float((d > 0).mean()))
    skew = __import__('scipy').stats.skew(X, axis=0)
    out = dict(paths=res['paths'].tolist(), se=se.tolist(), z=z.tolist(), p=p.tolist(), lo=lo.tolist(), hi=hi.tolist(), B=int(Bn),
               R2=res['R2'].tolist(), f2=f2(m, res).tolist(), weights=res['weights'].tolist(), w_se=wse.tolist(), w_p=wp.tolist(),
               loadings=res['loadings'].tolist(), rhoA={k: float(v) for k, v in rhoA(m, res, X).items()},
               rel={k: {kk: float(vv) for kk, vv in v.items()} for k, v in reliability(m, res).items()},
               diffs=diffs, skew=dict(zip(m.ind, skew.tolist())), iters=res['iters'])
    json.dump(out, open(f'{OUT}/full.json', 'w'), indent=1)
    np.savez_compressed(f'{OUT}/full_boot.npz', paths=paths, conv=conv, wts=wts)
    log('stage full saved')

# ---------------------------------------------------------------- Stage 2: subsampling across sizes
if stage in ('all', 'sub'):
    sizes = [int(s) for s in (sys.argv[2].split(',') if len(sys.argv) > 2 else '250,150,200,300,350'.split(','))]
    R = 1000
    for ns in sizes:
        B = 1000 if ns == 250 else 500
        rng = np.random.default_rng(1000 + ns)
        est = np.zeros((R, 10)); pv = np.zeros((R, 10)); se = np.zeros((R, 10)); lo = np.zeros((R, 10)); hi = np.zeros((R, 10))
        r2 = np.zeros((R, 2)); wAS = np.zeros((R, 4)); wASp = np.zeros((R, 4)); rA = np.zeros((R, m.J)); conv = np.zeros(R, bool); nconv = np.zeros(R, int)
        loadAS = np.zeros((R, 4))
        t = time.time()
        for r in range(R):
            idx = rng.choice(n, ns, replace=False)
            res, S = fit_with_boot(X[idx], rng, B)
            conv[r] = res['conv'][0]; nconv[r] = res['conv'][1:].sum()
            est[r] = res['paths'][0]; r2[r] = res['R2'][0][[m.cidx['pjoy'], m.cidx['as']]]
            s_, z_, p_, lo_, hi_, _ = boot_stats(res['paths'][0], res['paths'][1:], res['conv'][1:])
            pv[r] = p_; se[r] = s_; lo[r] = lo_; hi[r] = hi_
            wAS[r] = res['weights'][0][AS]; loadAS[r] = res['loadings'][0][AS]
            _, _, wp_, _, _, _ = boot_stats(res['weights'][0][AS], res['weights'][1:][:, AS], res['conv'][1:])
            wASp[r] = wp_
            ra = rhoA_batch(m, {'W': res['W'][:1]}, S[:1])
            rA[r] = [ra.get(c, [np.nan])[0] if c in ra else np.nan for c in m.cons]
            if (r + 1) % 100 == 0:
                log(f'sub n={ns} {r+1}/{R} {round(time.time()-t)}s')
        np.savez_compressed(f'{OUT}/sub_{ns}.npz', est=est, p=pv, se=se, lo=lo, hi=hi, r2=r2, wAS=wAS, wASp=wASp, rhoA=rA, conv=conv, nconv=nconv, loadAS=loadAS, B=B)
        log(f'stage sub n={ns} saved; conv {conv.sum()}/{R}')

# ---------------------------------------------------------------- Stage 3: independent-sample check at n = 250
if stage in ('all', 'indep'):
    res0 = fit(m, X); g = Generator(m, res0, X)
    log('generator calibrated, max abs err', round(g.calib_err, 4))
    rng = np.random.default_rng(777); R = 1000; B = 1000
    est = np.zeros((R, 10)); pv = np.zeros((R, 10)); conv = np.zeros(R, bool); t = time.time()
    for r in range(R):
        Xd = g.draw(rng, 250)
        res, _ = fit_with_boot(Xd, rng, B)
        conv[r] = res['conv'][0]; est[r] = res['paths'][0]
        pv[r] = boot_stats(res['paths'][0], res['paths'][1:], res['conv'][1:])[2]
        if (r + 1) % 200 == 0: log(f'indep {r+1}/{R} {round(time.time()-t)}s')
    np.savez_compressed(f'{OUT}/indep_250.npz', est=est, p=pv, conv=conv)
    log('stage indep saved')

# ---------------------------------------------------------------- Stage 4: power simulation
if stage in ('all', 'power'):
    res0 = fit(m, X); g = Generator(m, res0, X)
    grid = list(range(50, 891, 20)); REPS = 500; B = 300
    power = np.zeros((len(grid), 10)); meanest = np.zeros((len(grid), 10)); nconv = np.zeros(len(grid), int)
    allp = np.zeros((len(grid), REPS, 10)); allest = np.zeros((len(grid), REPS, 10)); start = 0
    if os.path.exists(f'{OUT}/power.npz'):
        d = np.load(f'{OUT}/power.npz'); start = int(d['done']) + 1
        power[:start] = d['power'][:start]; meanest[:start] = d['meanest'][:start]; nconv[:start] = d['nconv'][:start]; allp[:start] = d['allp'][:start]; allest[:start] = d['allest'][:start]
    t = time.time()
    for gi, ns in enumerate(grid):
        if gi < start: continue
        rng = np.random.default_rng(4242 + gi)
        pv = np.full((REPS, 10), np.nan); es = np.full((REPS, 10), np.nan); cv = np.zeros(REPS, bool)
        for r in range(REPS):
            Xd = g.draw(rng, ns)
            try:
                res, _ = fit_with_boot(Xd, rng, B)
            except np.linalg.LinAlgError:
                continue
            if not res['conv'][0] or res['conv'][1:].sum() < B // 2:
                continue
            cv[r] = True; es[r] = res['paths'][0]
            pv[r] = boot_stats(res['paths'][0], res['paths'][1:], res['conv'][1:])[2]
        power[gi] = (pv[cv] < .05).mean(0); meanest[gi] = es[cv].mean(0); nconv[gi] = cv.sum()
        allp[gi] = pv; allest[gi] = es
        log(f'power n={ns} conv {cv.sum()}/{REPS} power {np.round(power[gi],2)} {round(time.time()-t)}s')
        np.savez_compressed(f'{OUT}/power.npz', grid=np.array(grid), power=power, meanest=meanest, nconv=nconv, allp=allp, allest=allest, done=gi)
    log('stage power saved')
