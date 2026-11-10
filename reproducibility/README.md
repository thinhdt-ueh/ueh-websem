# Reproducibility

## conclusion-stability-plssem (v1.1.0)

`conclusion-stability-plssem/` is the reproduction package of

> *Which conclusions can a sample support? A claim-specific stability procedure for PLS-SEM in tourism research* (submitted to Tourism Management, 2026).

It holds the scripts, the model specification, the data, every output file and the figures behind Tables 3 to 8 and Figures 1 to 6. Its `README.md` maps each table and figure to a script stage, its settings, its seed and its output file. Run from `conclusion-stability-plssem/code/`:

```
pip install -r ../requirements.txt
python run_all.py full                  # Table 3, Figure 2
python run_all.py power                 # Table 5, Figure 3 (resumable)
python run_all.py sub 250               # Tables 6-7 (observed), Figures 4-5
python run_all.py sub 150,200,300,350   # Figure 6
python run_all.py indep                 # Table 7 (independent samples)
python run_extra.py                     # BCa intervals, saturated-population check
python analyze.py                       # results/summary.txt and Figures 3-6
```

Seeds are fixed, so the scripts reproduce the files in `results/` exactly. These batch scripts have no fit cap.

## The same workflow in AI-SEM itself

The package estimates PLS with the same algorithm as AI-SEM (path weighting, Mode A/B, stop criterion 1e-7, at most 300 iterations, bootstrap p values from the t distribution of the bootstrap ratio). On the Oliveira et al. (2020) data, AI-SEM's `pls.algorithm` and the package's `pls.py` agree to 3e-8 on every path.

The Step 2 generator of the package (`code/gen.py`) is part of AI-SEM as `pls/population.py`. It builds a composite-model population with observed within-block correlations and model-implied cross-block correlations, and maps each item onto its observed 7-point distribution through a calibrated Gaussian copula. The calibration seed and the number of iterations are the same as in `gen.py`. On the Oliveira data the two generators produce the same target matrix to 3e-8, and their draws agree in 99.99% of cells. AI-SEM uses this population in two places:

- **Web app:** Power Analysis offers the population choice "Calibrated to the data" or "Saturated" when a dataset is open.
- **Batch mode:** `python -m pls.batch` runs the whole workflow with no fit cap, on all CPU cores but one.

To run the workflow with AI-SEM's batch mode, from the repository root:

```
D=reproducibility/conclusion-stability-plssem/data
python -m pls.batch reference   --model $D/pls_model_oliveira2020.json --data $D/oliveira2020_data.csv --boot 10000 --seed 20261020 --out out/
python -m pls.batch power       --model $D/pls_model_oliveira2020.json --data $D/oliveira2020_data.csv --population calibrated --sizes 50:890:20 --reps 500 --boot 300 --seed 4242 --out out/
python -m pls.batch subsample   --model $D/pls_model_oliveira2020.json --data $D/oliveira2020_data.csv --sizes 150,200,250,300,350 --reps 1000 --boot 1000 --seed 1000 --out out/
python -m pls.batch independent --model $D/pls_model_oliveira2020.json --data $D/oliveira2020_data.csv --population calibrated --sizes 250 --reps 1000 --boot 1000 --seed 777 --out out/
python -m pls.batch independent --model $D/pls_model_oliveira2020.json --data $D/oliveira2020_data.csv --population saturated  --sizes 250 --reps 400  --boot 500  --seed 778 --out out/
```

AI-SEM's batch mode draws its random numbers in a different order from the package scripts. Its results therefore agree with Tables 5 to 7 within Monte Carlo error, not to the last digit. At n = 250 (200 replications, 100 bootstraps per fit), it gave power .32 for compliance and .49 for security and privacy, against .33 and .49 in Table 5. With 60 subsamples, the significant shares were 23% and 42%, against 25% and 42% in Table 6.

For digit-exact reproduction, use the package scripts. On one machine with 12 CPU cores, the full Table 5 grid takes about 4 to 5 hours in AI-SEM's batch mode, which fits each model separately. The package's batched estimator needs about 45 minutes on one core.

## Data licence

`conclusion-stability-plssem/data/oliveira2020_data.csv` is redistributed from Oliveira, T. (2020), *Data for: Why do people share their travel experiences on social media?*, Mendeley Data, V1, https://doi.org/10.17632/2g67vckxgz.1. It is licensed CC BY-NC 3.0 (attribution, non-commercial), not under the licence of AI-SEM's code. See `conclusion-stability-plssem/data/DATA_LICENSE.md`.
