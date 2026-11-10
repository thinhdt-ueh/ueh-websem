import matplotlib, os
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
fig = plt.figure(figsize=(17.48, 8.23), dpi=100)
ax = fig.add_axes([0,0,1,1]); ax.set_xlim(0, 100); ax.set_ylim(0, 100); ax.axis('off')
boxes = [
    (2,  "Step 1", "Estimate the reference\nmodel on the full sample\n\nBootstrap inference\nMeasurement quality\nEffect sizes (f²) and SE\nReproduce published\nestimates if available", "#e8f0fb"),
    (27.5, "Step 2", "Profile model conditioned\npower across an n grid\n\nStable boundary at .80\nReplications set by a\nprecision target\nRange of candidate n", "#e8f0fb"),
    (53, "Step 3", "Replicated case-deletion\nanalysis across sizes\n\nObserved share vs.\nanalytic prediction (π)\nSigns, pairwise differences,\nouter weights, R²", "#e8f0fb"),
    (78.5, "Step 4", "Calibrate and report\nclaims\n\nSupported\nDirectional tendency\nComparative claim\nInterval statement\nNot testable at n", "#e5f5e8"),
]
W, H, Y = 19.5, 52, 40
for x, title, body, col in boxes:
    ax.add_patch(FancyBboxPatch((x, Y), W, H, boxstyle="round,pad=0,rounding_size=1.5", linewidth=1.5, edgecolor="#444", facecolor=col))
    ax.text(x+W/2, Y+H-6, title, ha='center', va='center', fontsize=21, fontweight='bold')
    ax.text(x+W/2, Y+H/2-5, body, ha='center', va='center', fontsize=15, linespacing=1.45)
for x in (21.5, 47, 72.5):
    ax.add_patch(FancyArrowPatch((x+0.4, Y+H/2), (x+5.6, Y+H/2), arrowstyle='-|>', mutation_scale=22, linewidth=2, color='#333'))
ax.text(50, Y+H+4, "candidate range of n", ha='center', fontsize=16, style='italic')
ax.text(75.5, Y+H+4, "criteria met", ha='center', fontsize=16, style='italic')
ax.add_patch(FancyArrowPatch((62, Y-0.5), (38, Y-0.5), connectionstyle="arc3,rad=-0.4", arrowstyle='-|>', mutation_scale=22, linewidth=2, color='#8b1a1a'))
ax.text(50, 21, "criteria not met: test a larger n if data permit,\nor keep n and weaken the claim in Step 4", ha='center', va='center', fontsize=16, color='#8b1a1a', linespacing=1.4)
ax.text(24.5, 8, "Model based evidence (Steps 1 and 2)", ha='center', fontsize=17, fontweight='bold', color='#333')
ax.text(62.75, 8, "Data based evidence (Step 3)", ha='center', fontsize=17, fontweight='bold', color='#333')
fig.savefig(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'figures', 'fig1_workflow.png'), dpi=100, facecolor='white')
