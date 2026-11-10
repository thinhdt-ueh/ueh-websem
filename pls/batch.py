"""Batch (command-line) mode for long simulations, with no run-size caps.

Runs the conclusion-stability workflow on a model + dataset outside the web
app, on all CPU cores but one (pls/parallel.py; WEBSEM_WORKERS overrides):

    python -m pls.batch reference   --model M.json --data D.csv --boot 10000 --out results/
    python -m pls.batch power       --model M.json --data D.csv --population calibrated \\
                                    --sizes 50:890:20 --reps 500 --boot 300 --out results/
    python -m pls.batch subsample   --model M.json --data D.csv --sizes 150,200,250,300,350 \\
                                    --reps 1000 --boot 1000 --out results/
    python -m pls.batch independent --model M.json --data D.csv --population calibrated \\
                                    --sizes 250 --reps 1000 --boot 1000 --out results/

reference  full-sample estimates with bootstrap SE, z, p and percentile CI.
power      Step 2: share of converged replicates in which each path is
           significant, per sample size, drawn from the model ("model" needs
           --path-values/--loadings), a data-calibrated composite population
           ("calibrated") or the observed correlation matrix ("saturated"),
           both through a Gaussian copula fitted to the item marginals
           (pls/population.py). Resumable: sizes already in power.csv are skipped.
subsample  Step 3: random subsamples without replacement, each re-estimated
           with its own bootstrap; per path the median/IQR/range of the
           coefficient, share significant, decision and sign agreement with
           the reference, and the analytic prediction of the share (needs
           `reference` first).
independent  Step 3 check: independent samples drawn from a population.

Model files are AI-SEM model exports (Step 2 > Export model); data files are
CSV or Excel with one column per indicator. Every output is a CSV (plus a
JSON of the settings); seeds are explicit, so runs are reproducible.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time

os.environ.setdefault("AISEM_LOCAL", "1")  # batch mode is local by definition: no hosted caps

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from scipy.stats import norm  # noqa: E402

from .algorithm import run_pls_algorithm  # noqa: E402
from .bootstrap import run_bootstrap  # noqa: E402
from .model import Model  # noqa: E402
from .parallel import run_tasks, worker_count  # noqa: E402

ALPHA = 0.05


# ---------------------------------------------------------------- helpers
def load_inputs(model_path: str, data_path: str) -> tuple[Model, pd.DataFrame]:
    with open(model_path, encoding="utf-8") as f:
        model = Model.from_json(json.load(f))
    df = pd.read_excel(data_path) if data_path.lower().endswith((".xlsx", ".xls")) else pd.read_csv(data_path)
    df = df[model.all_indicators()].apply(pd.to_numeric, errors="coerce").dropna().reset_index(drop=True)
    return model, df


def parse_sizes(spec: str) -> list[int]:
    """'50:890:20' (from:to:step, inclusive) or '150,200,250'."""
    if ":" in spec:
        a, b, c = (int(x) for x in spec.split(":"))
        return list(range(a, b + 1, c))
    return [int(x) for x in spec.split(",") if x.strip()]


class Progress:
    def __init__(self, label: str):
        self.label, self.start, self.last = label, time.time(), -1

    def __call__(self, done, total):
        pct = int(100 * done / total) if total else 100
        if pct // 5 != self.last // 5 or pct == 100:
            self.last = pct
            print(f"  {self.label}: {pct:3d}%  {time.time() - self.start:7.0f}s", flush=True)


def fit_with_bootstrap(model: Model, df: pd.DataFrame, n_boot: int, seed: int):
    """Point estimates + bootstrap path statistics; None if the fit fails."""
    try:
        result = run_pls_algorithm(model, df)
    except (ValueError, np.linalg.LinAlgError):
        return None
    if not result.converged:
        return None
    try:
        boot = run_bootstrap(model, result, n_boot=n_boot, seed=seed)
    except np.linalg.LinAlgError:
        return None
    paths = {(r["source"], r["target"]): (r["original"], r["std"], r["p_value"], r["ci_lower"], r["ci_upper"])
             for r in boot.path_stats}
    return {"paths": paths, "r2": result.r_squared.to_dict(), "n_valid": boot.n_valid}


def _sample_task(model, df, n_boot, seed):
    """Module-level so worker processes can unpickle it (pls/parallel.py)."""
    return fit_with_bootstrap(model, df, n_boot, seed)


def _population_task(model, population, n, n_boot, seed_seq):
    rng = np.random.default_rng(seed_seq)
    return fit_with_bootstrap(model, population.draw(rng, n), n_boot, int(rng.integers(0, 2**31 - 1)))


def predicted_share(beta: float, se: float, n_full: int, n: int, overlapping: bool) -> float:
    """Analytic prediction of the share significant at two-sided alpha = .05 in
    subsamples of n from N cases (overlap factor sqrt(1 - n/N)), or in
    independent samples centred on the full-sample estimate (factor 1)."""
    if not se or se <= 0:
        return float("nan")
    z_n = abs(beta) / (se * np.sqrt(n_full / n))
    f = np.sqrt(max(1 - n / n_full, 1e-12)) if overlapping else 1.0
    crit = norm.ppf(1 - ALPHA / 2)
    return float(norm.cdf((z_n - crit) / f) + norm.cdf((-z_n - crit) / f))


def write_csv(path: str, rows: list[dict]) -> None:
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def path_label(model: Model, src: str, tgt: str) -> str:
    return f"{model.constructs[src].name} -> {model.constructs[tgt].name}"


# ---------------------------------------------------------------- commands
def cmd_reference(a, model, df):
    print(f"reference: n={len(df)}, {a.boot} bootstraps, seed {a.seed}", flush=True)
    res = fit_with_bootstrap(model, df, a.boot, a.seed)
    if res is None:
        sys.exit("the model did not converge on the full sample")
    rows = []
    for (s, t_), (b, se, p, lo, hi) in res["paths"].items():
        rows.append(dict(source=s, target=t_, path=path_label(model, s, t_), beta=b, se=se,
                         z=b / se if se else None, p=p, ci_lower=lo, ci_upper=hi))
    write_csv(os.path.join(a.out, "reference.csv"), rows)
    with open(os.path.join(a.out, "reference.json"), "w", encoding="utf-8") as f:
        json.dump(dict(n=len(df), boot=a.boot, seed=a.seed, n_valid=res["n_valid"], r2=res["r2"], paths=rows), f, indent=1)
    for r in rows:
        print(f"  {r['path']:55s} beta={r['beta']:+.3f} SE={r['se']:.3f} p={r['p']:.4f}")


def cmd_power(a, model, df):
    from .power_analysis import run_power_analysis
    from .population import build_population

    sizes = parse_sizes(a.sizes)
    population = None if a.population == "model" else build_population(model, df, a.population)
    path_values, loading_values = {}, {}
    if population is None:
        if not (a.path_values and a.loadings):
            sys.exit("--population model needs --path-values and --loadings (JSON files)")
        with open(a.path_values, encoding="utf-8") as f:
            path_values = {tuple(k.split("->", 1)): float(v) for k, v in json.load(f).items()}
        with open(a.loadings, encoding="utf-8") as f:
            loading_values = {k: float(v) for k, v in json.load(f).items()}
    else:
        print(f"population {a.population}: copula calibration max abs error {population.calibration_error:.3f}", flush=True)

    out_csv = os.path.join(a.out, "power.csv")
    rows = pd.read_csv(out_csv).to_dict("records") if os.path.exists(out_csv) else []
    done = {int(r["n"]) for r in rows}
    with open(os.path.join(a.out, "power_settings.json"), "w", encoding="utf-8") as f:
        json.dump(dict(population=a.population, sizes=sizes, reps=a.reps, boot=a.boot, seed=a.seed,
                       engine=a.engine, workers=worker_count(),
                       calibration_error=None if population is None else population.calibration_error), f, indent=1)
    for gi, n in enumerate(sizes):
        if n in done:
            continue
        kw = dict(sample_sizes=[n], n_mc=a.reps, seed=a.seed + gi, progress=Progress(f"power n={n}"), population=population)
        if a.engine == "cbsem":
            from cbsem.power_analysis import run_power_analysis as run_cbsem_power
            points = run_cbsem_power(model, path_values, loading_values, **kw)
        else:
            points = run_power_analysis(model, path_values, loading_values, n_boot_inner=a.boot, **kw)
        for p in points:
            mcse = np.sqrt(p.power * (1 - p.power) / p.n_converged) if p.n_converged else None
            rows.append(dict(n=n, source=p.source, target=p.target, path=path_label(model, p.source, p.target),
                             power=p.power, mcse=mcse, n_converged=p.n_converged, n_replicates=p.n_replicates,
                             mean_estimate=p.mean_estimate))
        write_csv(out_csv, rows)  # after every size, so an interrupted run resumes here
        print(f"power n={n}: " + "  ".join(f"{p.source}->{p.target} {p.power:.2f}" for p in points), flush=True)


def _summarize_runs(model, results, reference, n_full, n, overlapping):
    ref = {(r["source"], r["target"]): r for r in reference["paths"]}
    ok = [r for r in results if r is not None]
    rows = []
    for (s, t_), rr in ref.items():
        est = np.array([r["paths"][(s, t_)][0] for r in ok])
        p = np.array([r["paths"][(s, t_)][2] if r["paths"][(s, t_)][2] is not None else 1.0 for r in ok])
        sig = p < ALPHA
        full_sig = rr["p"] < ALPHA
        share = float(sig.mean()) if len(ok) else float("nan")
        rows.append(dict(
            path=path_label(model, s, t_), full_beta=rr["beta"], median=float(np.median(est)),
            q1=float(np.percentile(est, 25)), q3=float(np.percentile(est, 75)), min=float(est.min()), max=float(est.max()),
            share_significant=share, mcse=float(np.sqrt(share * (1 - share) / len(ok))),
            decision_agreement=float((sig == full_sig).mean()),
            sign_agreement=float((np.sign(est) == np.sign(rr["beta"])).mean()),
            predicted_share=predicted_share(rr["beta"], rr["se"], n_full, n, overlapping),
            n_valid=len(ok), n_runs=len(results)))
    return rows


def _load_reference(a):
    path = os.path.join(a.out, "reference.json")
    if not os.path.exists(path):
        sys.exit(f"{path} not found: run `python -m pls.batch reference` with the same --out first")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def cmd_subsample(a, model, df):
    reference = _load_reference(a)
    N = len(df)
    for n in parse_sizes(a.sizes):
        rng = np.random.default_rng(a.seed + n)
        tasks = [(model, df.iloc[rng.choice(N, n, replace=False)].reset_index(drop=True), a.boot,
                  int(rng.integers(0, 2**31 - 1))) for _ in range(a.reps)]
        results = run_tasks(_sample_task, tasks, [1] * len(tasks), Progress(f"subsample n={n}"))
        _write_runs(a, model, results, f"subsample_{n}")
        write_csv(os.path.join(a.out, f"subsample_{n}_summary.csv"),
                  _summarize_runs(model, results, reference, N, n, overlapping=True))
        print(f"subsample n={n} saved", flush=True)


def cmd_independent(a, model, df):
    from .population import build_population

    reference = _load_reference(a)
    population = build_population(model, df, a.population)
    print(f"population {a.population}: copula calibration max abs error {population.calibration_error:.3f}", flush=True)
    for n in parse_sizes(a.sizes):
        seeds = np.random.SeedSequence(a.seed + n).spawn(a.reps)
        tasks = [(model, population, n, a.boot, s) for s in seeds]
        results = run_tasks(_population_task, tasks, [1] * len(tasks), Progress(f"independent n={n}"))
        _write_runs(a, model, results, f"independent_{a.population}_{n}")
        write_csv(os.path.join(a.out, f"independent_{a.population}_{n}_summary.csv"),
                  _summarize_runs(model, results, reference, len(df), n, overlapping=False))
        print(f"independent n={n} saved", flush=True)


def _write_runs(a, model, results, stem):
    rows = []
    for i, r in enumerate(results):
        if r is None:
            rows.append(dict(run=i, source=None, target=None, beta=None, se=None, p=None, converged=False))
            continue
        for (s, t_), (b, se, p, _lo, _hi) in r["paths"].items():
            rows.append(dict(run=i, source=s, target=t_, beta=b, se=se, p=p, converged=True))
        for cid, v in r["r2"].items():
            rows.append(dict(run=i, source="R2", target=cid, beta=v, se=None, p=None, converged=True))
    write_csv(os.path.join(a.out, f"{stem}_runs.csv"), rows)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pls.batch", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["reference", "power", "subsample", "independent"])
    ap.add_argument("--model", required=True, help="AI-SEM model export (JSON)")
    ap.add_argument("--data", required=True, help="CSV or Excel, one column per indicator")
    ap.add_argument("--out", required=True, help="output folder")
    ap.add_argument("--sizes", default="250", help="'from:to:step' or a comma list")
    ap.add_argument("--reps", type=int, default=500, help="replications / subsamples per size")
    ap.add_argument("--boot", type=int, default=300, help="bootstrap resamples per fit")
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--population", default="calibrated", choices=["model", "calibrated", "saturated"])
    ap.add_argument("--engine", default="pls", choices=["pls", "cbsem"], help="power only")
    ap.add_argument("--path-values", help="power with --population model: JSON {\"src->tgt\": beta}")
    ap.add_argument("--loadings", help="power with --population model: JSON {construct_id: loading}")
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    model, df = load_inputs(a.model, a.data)
    print(f"AI-SEM batch {a.command}: {len(df)} cases, {len(model.all_indicators())} indicators, "
          f"{worker_count()} worker process(es)", flush=True)
    {"reference": cmd_reference, "power": cmd_power, "subsample": cmd_subsample,
     "independent": cmd_independent}[a.command](a, model, df)


if __name__ == "__main__":
    main()
