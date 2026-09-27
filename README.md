# AI-SEM

*AI-Enabled for SEM*

AI-SEM is a browser-based **Structural Equation Modeling** application
(Flask + Python) that runs both major estimation traditions —
**PLS-SEM** (Partial Least Squares, the method used by SmartPLS) and
**CB-SEM** (Covariance-Based Maximum Likelihood, the method used by
AMOS/lavaan/Mplus) — from a single drag-and-drop model builder. The same
model (constructs, indicators, paths) can be estimated with either method
by switching the estimator in Step 2 and re-running.

The interface is fully bilingual (English / Vietnamese, English by default)
and every analysis ships with reading guides and a "computation
transparency" panel showing the exact Python source that produced the
numbers.

Downloads (Windows `.exe`, macOS app): <https://ai-sem.com/downloads/>

## Features

### Core estimation

- **PLS-SEM**: the classic Lohmöller/Wold PLS algorithm (path weighting
  scheme, Mode A and Mode B) implemented in NumPy.
- **CB-SEM**: Maximum Likelihood via [`semopy`](https://semopy.com/), with
  χ², CFI, TLI, RMSEA, SRMR, GFI, AGFI, NFI, AIC and BIC, and
  unstandardized/standardized estimates with ML standard errors. Reflective
  constructs only.
- Measurement model: outer loadings/weights, cross loadings, Cronbach's
  alpha, rho_A, composite reliability, AVE, Fornell-Larcker, HTMT.
- Structural model: path coefficients, R², adjusted R², f², inner VIF,
  outer VIF for formative blocks.
- **Bootstrapping** (100–5,000 resamples) with per-construct sign
  correction: t-values, p-values, 95% percentile confidence intervals, and
  bootstrap distribution charts.
- **Blindfolding / Q²** (omission distance D = 7).
- **Common Method Bias** — full collinearity test (Kock, 2015).

### Mediation, moderation and categorical variables

- Total, indirect and specific indirect effects; index of moderated
  mediation (Hayes, 2015).
- **Moderation** with interaction constructs: two-way and three-way,
  two-stage, product-indicator and orthogonalization approaches, created by
  dragging a moderator onto a path or through a dialog; simple-slopes
  charts.
- **Dummy variables**: k−1 coding of any categorical column (2–12
  categories) against a chosen reference category, optionally added as
  single-indicator constructs for use as control or independent variables.

### Extended assessment and study-design tools

- **PLSpredict** (k-fold out-of-sample prediction vs. a linear benchmark).
- **IPMA** (importance-performance map analysis).
- **PLS-MGA** (multi-group analysis) with four tests side by side:
  parametric, Welch-Satterthwaite, permutation, and Henseler's PLS-MGA.
- **Sample-size sensitivity**: shrink-by-step and repeated resampling at a
  fixed size, optional p-value trajectories, and per-row export of the exact
  observations used.
- **Monte Carlo power analysis**.
- **Machine-learning comparison** (linear models, random forest, XGBoost,
  LightGBM, CatBoost) using permutation importance, compared with SEM path
  coefficients.

### AI Lab (bring your own OpenAI, Gemini or Claude API key)

- AI construct and indicator search with APA citations.
- Synthetic survey data generation from a codebook (Likert and open-ended
  questions) and a respondent profile, generated in batches with automatic
  retries and full prompt transparency.
- **AI Lab Experiment**: reusable Worker Pools of AI personas whose
  demographics are assigned by a seeded random generator (not by the AI),
  and between-subjects experiments with a shared context plus per-group
  manipulations; the output includes a `condition_group` column ready for
  PLS-MGA.
- AI scoring of open-ended answers into new Likert indicators (repeatable).
- AI-proposed structural paths (with an editable prompt review step).
- AI-written academic reports from the computed results.

API keys are sent directly to the chosen provider for each request and are
never stored on the server.

### Reporting and usability

- Excel (`.xlsx`) and Word (`.docx`) export for PLS-SEM, CB-SEM and the ML
  comparison, in the language selected at export time.
- Model import/export as JSON (constructs, indicators, paths, node
  positions).
- The whole session (data, model, results, unfinished AI Lab work) is saved
  in the browser's `localStorage` and restored on reload; a "Clear session"
  button in the footer resets it. There are no user accounts.
- Responsive layout with touch support for the model canvas.
- Upload limit: 5,000 rows per file (CSV with `,` or `;` delimiters, XLSX,
  XLS).

## Documentation

Bilingual user documentation is served by the app itself:

- `static/docs/user_guide_en.html` / `static/docs/user_guide_vi.html` — quick
  user guide.
- `static/docs/handbook.html` — a full bilingual handbook (SEM theory,
  thresholds, worked examples, and every feature).
- Screenshots live in `static/docs/images/{en,vi}/` and are regenerated from
  the running app with `scripts/capture_doc_screenshots.py`.

Developer notes are in [`docs/claude_handover.md`](docs/claude_handover.md).

## Installation

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
```

## Running

```bash
python app.py
```

Then open <http://127.0.0.1:5000>.

### Docker

```bash
docker compose up --build
```

The app is served by gunicorn on port 5000.

### Desktop builds

- **Windows**: `build_exe.bat` (PyInstaller, one-file) produces
  `dist\AI-SEM.exe`.
- **macOS**: PyInstaller cannot cross-compile, so the app is built on a
  GitHub Actions macOS runner (`.github/workflows/build-macos.yml`, run it
  manually or push a `v*` tag).

`desktop_launcher.py` starts a local server and opens the default browser;
uploads are stored in a persistent user directory.

### Deploying to Render.com

`Procfile` and `render.yaml` are included (gunicorn, debug off). Create a
**Blueprint** on Render pointing at this repository and apply it. On the
free plan the service sleeps after 15 minutes of inactivity and the
`uploads/` disk is ephemeral. Long-running analyses (power analysis, ML
comparison) need the generous `--timeout 2400` already configured.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

The suite (`tests/`) covers the PLS-SEM and CB-SEM algorithms, moderation,
bootstrapping, metrics, PLSpredict, IPMA, MGA, sensitivity, dummy coding and
every major API route. AI provider calls are always mocked. Tests run on
every push and pull request via `.github/workflows/tests.yml`.

## Project structure

```
app.py                  Flask app factory, blueprint registration
i18n.py                 Backend translation catalog (errors, report labels), EN/VI
desktop_launcher.py     Entry point for the packaged desktop app
pls/                    PLS-SEM: model, algorithm, metrics, bootstrap, blindfolding,
                        effects, moderation, PLSpredict, IPMA, MGA, power, reports
cbsem/                  CB-SEM: semopy estimator, metrics, moderation, power, reports
ml_compare/             Machine-learning comparison engine and reports
routes/                 REST API blueprints (analysis, exports, AI Lab, MGA, dummy coding, ...)
static/js/              Front end: app.js (orchestration), diagram.js (canvas editor),
                        i18n.js (UI translation catalog), per-page scripts
static/docs/            User guide, handbook and screenshots
templates/              Main page and standalone result pages
sample_data/            TAM sample dataset
scripts/                Sample-data generation, smoke tests, screenshot capture
tests/                  pytest suite
```

## Technical notes

- Data are standardized (mean 0, population SD) before PLS estimation,
  following the SmartPLS convention. Rows with a missing value on any model
  indicator are dropped listwise.
- Bootstrapping resamples with replacement and re-runs the full PLS
  algorithm on each resample; t = |original estimate| / bootstrap SD, with
  p-values from a t distribution with (valid resamples − 1) degrees of
  freedom. The loop is pure NumPy to keep web requests fast.
- The full collinearity VIF regresses every construct on all other
  constructs (not only its structural predictors), following Kock (2015);
  the 3.3 threshold applies to both PLS-SEM (LV scores) and CB-SEM (factor
  scores).
- Blindfolding omits every D-th row of each reflective endogenous block
  (row-wise, as in semPLS with `dlines = TRUE`), replaces omitted cells with
  the mean of the remaining rows, re-estimates the model, and predicts the
  omitted block from its predecessors only. Mean replacement differs from
  SmartPLS's default pairwise handling, so Q² can differ slightly.
- CB-SEM translates the model into lavaan-style syntax for `semopy`. R² is
  computed from standardized residual variances; SRMR is computed from the
  observed vs. model-implied correlation matrices. Reliability and validity
  metrics reuse the PLS formulas with ML loadings and factor scores.
- Excel/Word reports are rebuilt from the result JSON already in the
  browser, so exporting never re-runs the estimation.
- Translation uses two plain lookup catalogs — `i18n.py` (back end) and
  `static/js/i18n.js` (front end) — and the current language is sent with
  every request. Standard statistical terms (AVE, VIF, HTMT, CFI, RMSEA, R²)
  are kept in English in both languages.

## Disclaimer

AI-SEM is a teaching and research aid. Synthetic data produced by the AI Lab
features simulates plausible responses and must never be reported as
empirical findings; AI-generated citations and reports must be verified by
the researcher.
