# Changelog

## v1.1.0 - 2026-10-20 (matches the revised manuscript)
- Step 2 generator replaced: composite-model population with observed within-block correlations and a Gaussian copula calibrated to the 7-point item marginals (`gen.py`). The previous generator rounded normal indicators without attenuation correction and under-recovered the fitted coefficients by 6-8% at every n.
- Batch scripts (`run_all.py`) with no fit cap: 500 replications x 300 bootstraps per grid point; 1,000 subsamples x 1,000 bootstraps; resumable power stage.
- Added: stability across subsample sizes, independent-sample check (fitted-model and saturated populations), pairwise differences with full-sample BCa test, formative weights and rho_A across subsamples, Type S/M, analytic prediction of subsample significance shares.

## v1.0.0 - 2026-09 (first submission)
- Power report with 30 replications x 100 bootstraps; subsampling with R = 100.
