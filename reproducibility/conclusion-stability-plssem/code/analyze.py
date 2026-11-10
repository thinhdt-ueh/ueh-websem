import numpy as np, json, os
from scipy import stats
from scipy.stats import norm, spearmanr
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from pls import load

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'results'); FIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'figures'); os.makedirs(FIG, exist_ok=True)
m, X, df = load(); N = X.shape[0]
H = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10']
short = ['Identification → PE', 'Internalization → PE', 'Compliance → PE', 'PE → AS', 'Altruistic motivations → AS',
         'Personal fulfillment → AS', 'Environmental reasons → AS', 'Personal reasons → AS', 'Relationship reasons → AS', 'Security and privacy → AS']
full = json.load(open(f'{OUT}/full.json'))
beta = np.array(full['paths']); se = np.array(full['se']); fullp = np.array(full['p'])
sig_full = fullp < .05
res = {}

def pred_share(beta, se, n, N, overlap=True):
    zn = np.abs(beta) / (se * np.sqrt(N / n)); f = np.sqrt(1 - n / N) if overlap else 1.0
    return norm.cdf((zn - 1.96) / f) + norm.cdf((-zn - 1.96) / f), zn

def mcse(p, R): return np.sqrt(p * (1 - p) / R)

# ---------------- subsampling summaries
sizes = [150, 200, 250, 300, 350]
sub = {}
for ns in sizes:
    f = f'{OUT}/sub_{ns}.npz'
    if not os.path.exists(f): continue
    d = np.load(f); c = d['conv']
    est, p, r2, wAS, wASp, rA, lo, hi, sse = d['est'][c], d['p'][c], d['r2'][c], d['wAS'][c], d['wASp'][c], d['rhoA'][c], d['lo'][c], d['hi'][c], d['se'][c]
    R = c.sum()
    sig = (p < .05).mean(0)
    signagree = (np.sign(est) == np.sign(beta)).mean(0)
    decision = ((p < .05) == sig_full).mean(0)
    pairs = {'PE − altruism': est[:, 3] - est[:, 4], 'PE − personal fulfillment': est[:, 3] - est[:, 5],
             'Internalization − identification': est[:, 1] - est[:, 0], 'Privacy − personal reasons': est[:, 9] - est[:, 7],
             'Altruism − personal fulfillment': est[:, 4] - est[:, 5]}
    pairsum = {k: dict(median=float(np.median(v)), q1=float(np.percentile(v, 25)), q3=float(np.percentile(v, 75)),
                       mn=float(v.min()), mx=float(v.max()), share_same_sign=float((np.sign(v) == np.sign(np.median(v))).mean()),
                       share_pos=float((v > 0).mean())) for k, v in pairs.items()}
    # spearman agreement of AS predictors (6) and PE predictors (3)
    asp = [3, 4, 5, 6, 7, 8, 9]; pep = [0, 1, 2]
    sp_as = np.array([spearmanr(beta[asp], e[asp])[0] for e in est]); sp_pe = np.array([spearmanr(beta[pep], e[pep])[0] for e in est])
    # Type S and M
    typeS = ((np.sign(est) != np.sign(beta)) & (p < .05)).sum(0) / np.maximum((p < .05).sum(0), 1)
    typeM = np.array([np.median(np.abs(est[p[:, k] < .05, k])) / abs(beta[k]) if (p[:, k] < .05).sum() > 0 else np.nan for k in range(10)])
    sub[ns] = dict(R=int(R), B=int(d['B']), nconv_boot_mean=float(d['nconv'][c].mean()),
                   median=np.median(est, 0), q1=np.percentile(est, 25, 0), q3=np.percentile(est, 75, 0), mn=est.min(0), mx=est.max(0),
                   sig=sig, signagree=signagree, decision=decision, r2med=np.median(r2, 0), r2q1=np.percentile(r2, 25, 0), r2q3=np.percentile(r2, 75, 0),
                   wmed=np.median(wAS, 0), wq1=np.percentile(wAS, 25, 0), wq3=np.percentile(wAS, 75, 0), wmin=wAS.min(0), wmax=wAS.max(0),
                   wsignflip=(wAS < 0).mean(0), wnonsig=(wASp >= .05).mean(0),
                   rhoA_gt1={c_: float((rA[:, m.cidx[c_]] > 1).mean()) for c_ in ['comp', 'er', 'pr', 'rr']},
                   pairs=pairsum, sp_as_med=float(np.median(sp_as)), sp_as_q1=float(np.percentile(sp_as, 25)), sp_as_q3=float(np.percentile(sp_as, 75)),
                   sp_pe_med=float(np.median(sp_pe)), sp_pe_q1=float(np.percentile(sp_pe, 25)), sp_pe_q3=float(np.percentile(sp_pe, 75)),
                   typeS=typeS, typeM=typeM, med_lo=np.median(lo, 0), med_hi=np.median(hi, 0), mean_se=sse.mean(0),
                   est=est, p=p, wAS=wAS, wASp=wASp, rA=rA, sse=sse)

def fmt(x, d=3):
    s = f'{x:.{d}f}'; return s.replace('0.', '.', 1) if abs(x) < 1 else s
def pct(x): return f'{100*x:.0f}%'

lines = []
L = lines.append
L('=== FULL SAMPLE (10,000 bootstraps) ===')
for k in range(10):
    L(f"{H[k]:4s} {short[k]:30s} β={fmt(beta[k])} SE={fmt(se[k])} z={beta[k]/se[k]:.2f} p={full['p'][k]:.4f} CI=[{fmt(full['lo'][k])}, {fmt(full['hi'][k])}] f2={fmt(full['f2'][k])}")
L('R2 ' + str({c: round(full['R2'][m.cidx[c]], 3) for c in m.endo}))
L('AS weights ' + str(np.round(full['weights'][18:22], 3)) + ' p ' + str(np.round(full['w_p'][18:22], 4)))
L('rhoA ' + str({k: round(v, 3) for k, v in full['rhoA'].items() if k != 'as'}))
L('Pairwise differences (full sample):')
for k, v in full['diffs'].items():
    L(f"  {k:12s} est={fmt(v['est'])} SE={fmt(v['se'])} CI=[{fmt(v['lo'])}, {fmt(v['hi'])}] p={v['p']:.3f}")
L('Skewness: ' + ', '.join(f"{k} {v:.2f}" for k, v in full['skew'].items()))

if 250 in sub:
    s = sub[250]; R = s['R']
    L(f"\n=== SUBSAMPLING n=250: R={R}, B={s['B']}, mean converged bootstraps {s['nconv_boot_mean']:.0f} ===")
    L('Table 6 (Path | full β | median | IQR | range | p<.05 | decision agreement | sign agreement | MCSE)')
    for k in range(10):
        L(f"{H[k]:4s} {fmt(beta[k])} {fmt(s['median'][k])} [{fmt(s['q1'][k])}, {fmt(s['q3'][k])}] [{fmt(s['mn'][k])} to {fmt(s['mx'][k])}] {pct(s['sig'][k])} {pct(s['decision'][k])} {pct(s['signagree'][k])}  mcse={mcse(s['sig'][k], R):.3f}")
    L(f"R2 PE median {fmt(s['r2med'][0])} IQR [{fmt(s['r2q1'][0])}, {fmt(s['r2q3'][0])}]; AS median {fmt(s['r2med'][1])} IQR [{fmt(s['r2q1'][1])}, {fmt(s['r2q3'][1])}]")
    L('Table 7 (predicted vs observed):')
    po, zn = pred_share(beta, se, 250, N, True); pi, _ = pred_share(beta, se, 250, N, False)
    ind = None
    if os.path.exists(f'{OUT}/indep_250.npz'):
        d = np.load(f'{OUT}/indep_250.npz'); c = d['conv']; ind = (d['p'][c] < .05).mean(0); indR = c.sum(); indest = d['est'][c]
    for k in range(10):
        L(f"{H[k]:4s} z={beta[k]/se[k]:.2f} z250={zn[k]:.2f} pred_overlap={pct(po[k])} pred_indep={pct(pi[k])} observed={pct(s['sig'][k])}" + (f" indep_sim={pct(ind[k])}" if ind is not None else ''))
    if ind is not None: L(f'independent samples: R={indR}; mean estimates {np.round(indest.mean(0),3)}')
    L('Type S (share of significant subsamples with wrong sign): ' + ' '.join(f"{H[k]}={pct(s['typeS'][k])}" for k in range(10)))
    L('Type M (median |est| among significant / |full β|): ' + ' '.join(f"{H[k]}={s['typeM'][k]:.2f}" for k in range(10)))
    L('Median subsample 95% CI: ' + ' '.join(f"{H[k]}=[{fmt(s['med_lo'][k])},{fmt(s['med_hi'][k])}]" for k in range(10)))
    L('Mean subsample bootstrap SE: ' + ' '.join(f"{H[k]}={fmt(s['mean_se'][k])}" for k in range(10)) + f"  (scaled full-sample SE: {np.round(se*np.sqrt(N/250),3)})")
    L('Pairwise differences within subsamples:')
    for k, v in s['pairs'].items():
        L(f"  {k:34s} median={fmt(v['median'])} IQR=[{fmt(v['q1'])}, {fmt(v['q3'])}] range=[{fmt(v['mn'])}, {fmt(v['mx'])}] share>0={pct(v['share_pos'])}")
    L(f"Spearman AS predictors: median {s['sp_as_med']:.2f} IQR [{s['sp_as_q1']:.2f}, {s['sp_as_q3']:.2f}]; PE predictors: median {s['sp_pe_med']:.2f} IQR [{s['sp_pe_q1']:.2f}, {s['sp_pe_q3']:.2f}]")
    L('AS outer weights (full .763 .169 .157 .175): median ' + str(np.round(s['wmed'], 3)) + ' IQR ' + str(np.round(s['wq1'], 3)) + str(np.round(s['wq3'], 3)) + ' min ' + str(np.round(s['wmin'], 3)) + ' sign<0 ' + str(np.round(s['wsignflip'], 3)) + ' nonsig ' + str(np.round(s['wnonsig'], 3)))
    L('rhoA > 1 share: ' + str(s['rhoA_gt1']))
    # altruism diagnostics
    est, p, sse, wAS, rA = s['est'], s['p'], s['sse'], s['wAS'], s['rA']
    ns_ = p[:, 4] >= .05; sg = ~ns_
    L(f"Altruism diagnostics: subsamples with H5 non-sig: {ns_.sum()}; mean β(H5) sig {est[sg,4].mean():.3f} vs nonsig {est[ns_,4].mean():.3f}; mean SE(H5) sig {sse[sg,4].mean():.3f} vs nonsig {sse[ns_,4].mean():.3f}; overall mean SE {sse[:,4].mean():.3f} vs scaled {se[4]*np.sqrt(N/250):.3f}")
    L(f"  AS weight AS1 mean: sig {wAS[sg,0].mean():.3f} vs nonsig {wAS[ns_,0].mean():.3f}; small weights mean (sig) {np.round(wAS[sg,1:].mean(0),3)} vs (nonsig) {np.round(wAS[ns_,1:].mean(0),3)}; any small weight <0: sig {pct((wAS[sg,1:]<0).any(1).mean())} vs nonsig {pct((wAS[ns_,1:]<0).any(1).mean())}")
    L(f"  rhoA comp>1: sig {pct((rA[sg,m.cidx['comp']]>1).mean())} vs nonsig {pct((rA[ns_,m.cidx['comp']]>1).mean())}; er>1: sig {pct((rA[sg,m.cidx['er']]>1).mean())} vs nonsig {pct((rA[ns_,m.cidx['er']]>1).mean())}")
    L(f"  distribution of β(H5): sd {est[:,4].std():.3f}, skew {stats.skew(est[:,4]):.2f}; z=β/SE across subsamples: median {np.median(est[:,4]/sse[:,4]):.2f}, share z>1.96 {pct((np.abs(est[:,4]/sse[:,4])>1.96).mean())}")
    L(f"  share of subsamples where altruism beta < .15: {pct((est[:,4]<.15).mean())}")
    # re-scoring at alternative thresholds
    L('Re-scoring: decision agreement thresholds 80/90/99; sign/rank 90/95/99')
    for thr in (.80, .90, .99):
        L(f"  decision ≥{thr:.0%}: " + ' '.join(f"{H[k]}={'pass' if s['decision'][k]>=thr else 'fail'}" for k in range(10)))
    for thr in (.90, .95, .99):
        L(f"  sign ≥{thr:.0%}: " + ' '.join(f"{H[k]}={'pass' if s['signagree'][k]>=thr else 'fail'}" for k in range(10)))
        L(f"  rank ≥{thr:.0%}: " + ' '.join(f"{k}={'pass' if max(v['share_pos'],1-v['share_pos'])>=thr else 'fail'}" for k, v in s['pairs'].items()))

L('\n=== STABILITY ACROSS SIZES ===')
for ns in sizes:
    if ns not in sub: continue
    s = sub[ns]
    L(f"n={ns} R={s['R']} B={s['B']}: sig " + ' '.join(pct(v) for v in s['sig']) + ' | decision ' + ' '.join(pct(v) for v in s['decision']) + ' | sign ' + ' '.join(pct(v) for v in s['signagree']) +
      f" | PE>AM {pct(s['pairs']['PE − altruism']['share_pos'])} IN>ID {pct(s['pairs']['Internalization − identification']['share_pos'])} SPR<PR {pct(1-s['pairs']['Privacy − personal reasons']['share_pos'])} | R2 PE {fmt(s['r2med'][0])} AS {fmt(s['r2med'][1])} | AS small w<0 {np.round(s['wsignflip'][1:],2)}")

# ---------------- power
if os.path.exists(f'{OUT}/power.npz'):
    d = np.load(f'{OUT}/power.npz'); grid = d['grid']; power = d['power']; done = int(d['done']); meanest = d['meanest']; nconv = d['nconv']
    L(f'\n=== POWER SIMULATION (grid points done: {done+1}/{len(grid)}, reps 500, boots 500) ===')
    g = grid[:done+1]; P = power[:done+1]
    def first_cross(k):
        w = np.where(P[:, k] >= .8)[0]; return int(g[w[0]]) if len(w) else None
    def stable(k):
        for i in range(len(g)):
            if (P[i:, k] >= .8).all(): return int(g[i])
        return None
    def at(n_, k):
        i = np.where(g == n_)[0]; return P[i[0], k] if len(i) else np.nan
    proj = [pred_share(beta[k], se[k], 250, N, False)[0] for k in range(10)]
    L('Table 5: path | f2 | first n ≥.80 | stable boundary | power 250 | projected 250 | power 390 | power 210')
    for k in range(10):
        L(f"{H[k]:4s} f2={fmt(full['f2'][k])} first={first_cross(k)} stable={stable(k)} p250={at(250,k):.2f} proj250={proj[k]:.2f} p390={at(390,k):.2f} p210={at(210,k):.2f} p230={at(230,k):.2f} p270={at(270,k):.2f}")
    L('converged reps per grid point: min ' + str(nconv[:done+1].min()) + ' max ' + str(nconv[:done+1].max()))
    L('mean estimate at n=890 vs full: ' + str(np.round(meanest[done], 3)) + ' vs ' + str(np.round(beta, 3)))
    L('max relative deviation of mean estimate at n=890: ' + str(np.round((np.abs(meanest[done]-beta)/np.abs(beta)).max(), 3)))
    # figure 3
    fig, ax = plt.subplots(figsize=(9, 4.76))
    for k in range(10):
        ax.plot(g, P[:, k], label=short[k], lw=1.6)
    ax.axhline(.8, ls='--', c='k', lw=1); ax.set_xlabel('Sample size n'); ax.set_ylabel('Power (share significant, α = .05)'); ax.set_ylim(0, 1.02)
    ax.legend(fontsize=7, ncol=2, loc='lower right'); fig.tight_layout(); fig.savefig(f'{FIG}/fig3_power.png', dpi=200)

# ---------------- figures 4, 5, 6
if 250 in sub:
    s = sub[250]; est, p = s['est'], s['p']; R = s['R']
    fig, ax = plt.subplots(figsize=(9, 4.89))
    ax.boxplot([est[:, k] for k in range(10)], tick_labels=H, whis=(0, 100), widths=.6, medianprops=dict(color='k'))
    ax.scatter(np.arange(1, 11), beta, marker='D', c='red', s=18, zorder=3, label='Full-sample estimate')
    ax.axhline(0, c='k', lw=.5); ax.set_ylabel('Path coefficient'); ax.legend(fontsize=8); fig.tight_layout(); fig.savefig(f'{FIG}/fig4_paths.png', dpi=200)
    fig, ax = plt.subplots(figsize=(9, 4.77))
    ax.boxplot([p[:, k] for k in range(10)], tick_labels=H, showfliers=True, flierprops=dict(markersize=2)); ax.axhline(.05, ls='--', c='r', lw=1); ax.set_ylabel('Bootstrap p value'); ax.set_yscale('symlog', linthresh=.01)
    fig.tight_layout(); fig.savefig(f'{FIG}/fig5_pvalues.png', dpi=200)
if len(sub) >= 2:
    ss = sorted(sub); fig, axes = plt.subplots(1, 3, figsize=(13, 4.2))
    for k in range(10):
        axes[0].plot(ss, [sub[n_]['decision'][k] for n_ in ss], marker='o', ms=3, label=H[k])
        axes[1].plot(ss, [sub[n_]['signagree'][k] for n_ in ss], marker='o', ms=3)
    for k, name in [('PE − altruism', 'PE > altruism'), ('PE − personal fulfillment', 'PE > personal fulfillment'), ('Internalization − identification', 'Internalization > identification'), ('Privacy − personal reasons', 'Privacy < personal reasons')]:
        vals = [sub[n_]['pairs'][k]['share_pos'] for n_ in ss]
        if 'Privacy' in k: vals = [1 - v for v in vals]
        axes[2].plot(ss, vals, marker='o', ms=3, label=name)
    axes[0].axhline(.9, ls='--', c='k', lw=1); axes[1].axhline(.95, ls='--', c='k', lw=1); axes[2].axhline(.95, ls='--', c='k', lw=1)
    axes[0].set_title('Decision agreement'); axes[1].set_title('Sign agreement'); axes[2].set_title('Rank retention (pairwise)')
    for a in axes: a.set_xlabel('Subsample size n'); a.set_ylim(0, 1.03)
    axes[0].legend(fontsize=6, ncol=2); axes[2].legend(fontsize=7); fig.tight_layout(); fig.savefig(f'{FIG}/fig6_curves.png', dpi=200)

open(f'{OUT}/summary.txt', 'w').write('\n'.join(lines)); print('\n'.join(lines))
