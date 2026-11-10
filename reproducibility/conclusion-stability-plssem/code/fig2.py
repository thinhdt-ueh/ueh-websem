import json, os, numpy as np
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'results')
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Ellipse, FancyArrowPatch
from pls import load

m, X, df = load()
full = json.load(open(os.path.join(OUT, 'full.json')))
beta = full['paths']; z = full['z']; p = full['p']; load_ = full['loadings']; wts = full['weights']
R2 = full['R2']

pos = {'ident': (2.7, 7.6), 'inter': (2.7, 5.4), 'comp': (2.7, 3.2), 'pjoy': (5.9, 5.4), 'am': (7.4, 8.9), 'pf': (10.6, 8.9),
       'as': (9.6, 5.4), 'er': (5.9, 2.0), 'pr': (8.3, 2.0), 'rr': (10.7, 2.0), 'spr': (13.1, 2.0)}
names = {'ident': 'Identification', 'inter': 'Internalization', 'comp': 'Compliance', 'pjoy': 'Perceived enjoyment',
         'am': 'Altruistic motivations', 'pf': 'Personal fulfillment', 'as': 'Actual sharing (AS)', 'er': 'Environmental reasons',
         'pr': 'Personal reasons', 'rr': 'Relationship reasons', 'spr': 'Security and privacy reasons'}
fig = plt.figure(figsize=(13.33, 7.24), dpi=160)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 14.6); ax.set_ylim(0, 10.5); ax.axis('off')
W, H = 2.3, 1.05
k = 0
for c in m.cons:
    x, y = pos[c]
    fc = '#fde9d9' if c == 'as' else ('#e8f0fb' if c == 'pjoy' else 'white')
    ax.add_patch(Ellipse((x, y), W, H, facecolor=fc, edgecolor='#333', lw=1.3, zorder=3))
    lab = names[c]
    if c in m.endo:
        lab += f'\nR² = {R2[m.cidx[c]]:.3f}'
    ax.text(x, y, lab, ha='center', va='center', fontsize=8.6, zorder=4)
    items = m.blocks[c]
    vals = [wts[m.iidx[i]] if c == 'as' else load_[m.iidx[i]] for i in items]
    tag = 'w' if c == 'as' else 'λ'
    txt = '\n'.join(f'{i} {tag} = {v:.3f}' for i, v in zip(items, vals))
    off = -0.62 - 0.17 * len(items) if y > 4.9 and c not in ('ident', 'inter', 'comp', 'pjoy', 'as') else (0.62 + 0.17 * len(items) if y < 2 else 0)
    if c in ('ident', 'inter', 'comp'):
        ax.text(x - W / 2 - 0.1, y, txt, ha='right', va='center', fontsize=6.6, color='#444', zorder=4)
    elif c == 'pjoy':
        ax.text(x, y + H / 2 + 0.1, txt, ha='center', va='bottom', fontsize=6.6, color='#444', zorder=4)
    elif c == 'as':
        ax.text(x + W / 2 + 0.1, y, txt, ha='left', va='center', fontsize=6.6, color='#444', zorder=4)
    elif y > 4.9:
        ax.text(x, y + H / 2 + 0.1, txt, ha='center', va='bottom', fontsize=6.6, color='#444', zorder=4)
    else:
        ax.text(x, y - H / 2 - 0.1, txt, ha='center', va='top', fontsize=6.6, color='#444', zorder=4)

def shrink(a, b, r=1.22):
    a, b = np.array(a), np.array(b); d = b - a; L = np.linalg.norm(d); u = d / L
    # ellipse boundary approx: scale by angle
    def edge(pt, dirv):
        ang = np.arctan2(dirv[1], dirv[0]); rx, ry = W / 2, H / 2
        return pt + np.array([rx * np.cos(ang), ry * np.sin(ang)]) * 1.02
    return edge(a, u), edge(b, -u)

for k, (s, t) in enumerate(m.paths):
    a, b = shrink(pos[s], pos[t])
    sig = p[k] < .05
    ax.add_patch(FancyArrowPatch(a, b, arrowstyle='-|>', mutation_scale=14, lw=1.4 if sig else 1.1, color='#222' if sig else '#777',
                                 linestyle='-' if sig else (0, (5, 3)), zorder=2))
    mid = (a + b) / 2; d = b - a; n_ = np.array([-d[1], d[0]]) / np.linalg.norm(d)
    lab = f'{beta[k]:.3f} ({abs(z[k]):.2f})'
    offs = 0.22
    if s in ('er', 'pr', 'rr', 'spr'): offs = -0.22 if s in ('pr', 'rr') else 0.22
    if s == 'am': offs = -0.22
    ax.text(mid[0] + n_[0] * offs, mid[1] + n_[1] * offs, lab, ha='center', va='center', fontsize=7.8,
            bbox=dict(boxstyle='round,pad=0.15', fc='white', ec='none', alpha=.9), zorder=5)
ax.text(0.3, 0.25, 'Path labels: standardized coefficient (bootstrap t, 10,000 resamples). Dashed arrows: not significant at α = .05. '
        'λ = outer loading (reflective), w = outer weight (formative AS).', fontsize=7.6, color='#333')
fig.savefig(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'figures', 'fig2_model.png'), dpi=160, facecolor='white')
print('ok')
