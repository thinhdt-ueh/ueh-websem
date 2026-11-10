# conclusion-stability-plssem

Code, data pointers and full outputs for *Which conclusions can a sample support? A claim-specific stability procedure for PLS-SEM in tourism research* (Tourism Management, submitted 2026). Release **v1.1.0** corresponds to the revised manuscript of 20 October 2026.

All analyses in Section 4 of the paper were produced with the scripts in `code/`. The PLS engine (`pls.py`) reproduces the published Oliveira et al. (2020) solution to three decimals (path coefficients, loadings, weights, R², AVE, CR, rho_A). It is the same estimation routine that runs inside AI-SEM (https://ai-sem.com); the batch scripts here have no fit cap and are what produced the reported settings.

## Layout

```
data/      oliveira2020_data.csv (32 model indicators, n = 381; Mendeley Data doi:10.17632/2g67vckxgz.1), pls_model_oliveira2020.json
code/      pls.py      PLS path modelling (path weighting, Mode A/B, tol 1e-7, max 300 iterations), bootstrap, f2, rho_A
           plsb.py     batched estimator (thousands of fits from indicator correlation matrices)
           gen.py      Step 2 generator: composite-model population, observed within-block correlations,
                       model-implied cross-block correlations, Gaussian copula calibrated to the 7-point item marginals
           run_all.py  stages: full | sub | indep | power   (see "Runs behind the tables")
           run_extra.py  BCa intervals, bootstrap-at-N comparison, saturated-population independent samples
           analyze.py  summarises results/ into results/summary.txt and draws Figures 3-6
           fig1.py, fig2.py  Figure 1 (workflow) and Figure 2 (path diagram)
results/   full outputs of every run (see table below)
figures/   fig1_workflow.png, fig2_model.png, fig3_power.png, fig4_paths.png, fig5_pvalues.png, fig6_curves.png
```

## Runs behind the tables and figures

| Paper | Script / stage | Settings | Output file |
|---|---|---|---|
| Table 3, Figure 2 | `run_all.py full` | 10,000 bootstraps, seed 20261020 | `results/full.json`, `results/full_boot.npz` |
| Table 5, Figure 3 | `run_all.py power` | n = 50..890 step 20, 500 replications, 300 bootstraps/fit, seed 4242 + grid index | `results/power.npz` (`power`, `meanest`, `allp`, `allest`) |
| Table 6, Table 7 (observed), Figures 4-5 | `run_all.py sub 250` | 1,000 subsamples x 1,000 bootstraps, seed 1250 | `results/sub_250.npz` |
| Figure 6 | `run_all.py sub 150,200,300,350` | 1,000 subsamples x 500 bootstraps, seed 1000 + n | `results/sub_{n}.npz` |
| Table 7 (independent), Section 4.4 | `run_all.py indep` | 1,000 samples of 250 from the fitted model, 1,000 bootstraps, seed 777 | `results/indep_250.npz` |
| Table 8 intervals, Section 4.4 saturated-population check | `run_extra.py` | BCa (10,000 bootstraps + jackknife); 400 samples x 500 bootstraps, seed 778 | `results/extra.json` |
| All derived numbers | `analyze.py` | - | `results/summary.txt` |

`results/summary.txt` lists every statistic quoted in Sections 4.2-4.6.

## Reproduce

```
pip install -r requirements.txt
cd code
python run_all.py full            # ~1 min
python run_all.py sub 250         # ~5 min
python run_all.py sub 150,200,300,350
python run_all.py indep           # ~5 min
python run_all.py power           # ~45 min, resumable (writes results/power.npz after each grid point)
python run_extra.py
python analyze.py
```

Single core, about 1 hour in total. Seeds are fixed; results reproduce to the last digit with numpy >= 1.26.

## Generator check (Section 3.2)

`python -c "import gen"` from `code/` prints the large-sample check: fitting 200,000 generated cases returns every path within .006 of the full-sample estimate (copula calibration error .010).
