# Claude handover — AI-SEM

Project state as of **2026-09-27**. Repositories: `thinhdt-ueh/ai-sem` (current, clean history) and `thinhdt-ueh/ueh-websem` (original, full history), branch `main`. Purpose: let the next working session (Claude) — or you — pick up the context immediately without rereading the whole chat history.

## 1. What AI-SEM is

A bilingual (EN/VI) PLS-SEM and CB-SEM web app built with Flask, a plain HTML canvas (no external diagram library), NumPy (hand-written PLS) and `semopy` (CB-SEM / Maximum Likelihood). Full user documentation: `static/docs/user_guide_{en,vi}.html` (quick guide) and `static/docs/handbook.html` (full bilingual handbook, 30 chapters + appendices) — **both are up to date with the latest features**; check them for the exact behaviour of a feature before reading code.

## 2. Features complete on `main`

**Statistical core (PLS-SEM and CB-SEM side by side, same feature set):**
- Outer weights/loadings, bootstrapping (t/p-values, sign correction), blindfolding (Q², D = 7 — skipped entirely when the model has moderation, because the algorithm can't rebuild interaction scores on each refit), rho_A, HTMT, Fornell-Larcker, VIF, f².
- **Moderation**: Interaction constructs (mode `I`), two-stage estimation (Henseler & Chin 2010), two-way and **three-way interactions** (drag-and-drop on the canvas or the manual source picker — both keep `construct.name` in sync when upgrading 2-way → 3-way). Simple-slopes charts split into three panels by the outer moderator's level for 3-way.
- Total & indirect effects (mediation), index of moderated mediation.
- Common method bias (full collinearity VIF, threshold 3.3).
- **PLS-MGA** — `pls/mga.py`, `routes/mga_api.py`: four methods (parametric, Welch-Satterthwaite, permutation, Henseler's PLS-MGA); supports moderation models (two-stage only).
- PLSpredict, IPMA, power analysis (Monte Carlo simulation).
- **Sample-size sensitivity**: two modes — shrink by step, and repeated resampling at a fixed size — both with an optional p-value chart (separate bootstrap for PLS, free for CB-SEM) and a **per-row CSV export of the original observations** used for one specific result (replays the exact random seed; does not re-run the model).
- Machine-learning comparison (random forest, XGBoost, LightGBM, CatBoost, linear regression/classification) via permutation importance, compared with path coefficients.

**AI Lab (`routes/ai_data_gen_api.py`) — one-pass synthetic data:**
- AI construct/indicator search (APA citations), Likert + qualitative codebook, persona-based survey generation (batched, automatic retries), AI-drawn structural model (with a prompt review step before sending), skip-to-model-design, save-all-proposals (JSON + Excel).

**AI Lab Experiment (`routes/ai_worker_api.py`) — reusable between-subjects experiments:**
- Two separate phases: build a **Worker Pool** (N fixed AI personas, Excel export/import for reuse across sessions), then run multiple **survey experiments** on that pool (true random selection of M ≤ N, split into condition groups).
- **Demographics are assigned by a seeded RNG BEFORE the AI is called** (never chosen by the AI) — "balanced" means an exact quota (50/50 or the chosen split), not "the AI tries to get close". This is the key fix for skewed AI-generated samples.
- Experimental conditions are split into a **shared context** (entered once) + a **per-group manipulation** — a proper between-subjects design.
- Each survey batch only receives the profiles of the workers in that batch (not the whole group) — less context noise.
- Codebook definition export/import (JSON), same format as AI Lab.
- Finalized data include a `condition_group` column, ready for PLS-MGA.

**AI rater — scoring open-ended answers (`routes/ai_qual_score_api.py`):**
- Shared by AI Lab and AI Lab Experiment: pick a qualitative column, write a rubric, the AI scores each answer on a Likert scale, and the scores are merged as a new indicator (the CSV is rewritten in place under the same `file_id`). **Scoring can be repeated** on the same column (different rubric/column name). CSV/Excel export buttons sit in the Step 2 (model builder) toolbar and always read the latest data on disk.

**Dummy variables for categorical data (`routes/dummy_api.py`):**
- "🔢 Create dummy variables" in the Step 2 toolbar, for any data (upload, sample, AI-generated). k−1 coding against a user-chosen reference category (default: the largest group); columns with 2–12 distinct values. New `{column}_{value}` columns are written into the data file under the same `file_id` (an `.xlsx`/`.xls` upload is converted once to `{file_id}.csv` and the original removed, so the `file_id` prefix lookup still finds exactly one file). Missing values stay NaN. Optionally adds a single-indicator construct per dummy for use as control/independent variables.

**Automatic session persistence (no login):**
- All progress (data, model diagram + node positions, PLS/CB-SEM results, unfinished work in both AI wizards) is saved to `localStorage` and restored on reload. "🗑 Clear session" in the footer wipes it. Implementation: `saveSession()`/`restoreSession()` in `static/js/app.js` — note the order inside `restoreSession()`: switch step/tab BEFORE calling `editor.loadFrom()` (the canvas sizes itself from the visible panel), and call `renderModelSummary()` after restoring the editor (it is not automatic and easy to forget).

**Reports & i18n:**
- Excel/Word export, AI-written reports (OpenAI/Gemini/Claude with the user's own API key, never stored server-side).
- Bilingual EN/VI via two separate catalogs — `i18n.py` (back end) / `static/js/i18n.js` (front end). English is the default. Audited: in English mode no Vietnamese string leaks through (including the Q² skip reasons in `pls/blindfolding.py`).
- Vietnamese text inside the source is intentional: translation catalogs, `L("vi", "en")` pairs, Vietnamese AI prompts used when the UI language is VI, and the default text of `data-i18n` elements in the templates.

**Documentation (`static/docs/`):**
- `user_guide_en.html`, `user_guide_vi.html` (quick guide) and `handbook.html` (bilingual handbook, 30 chapters + appendices).
- Screenshots live in `static/docs/images/{en,vi}/<key>.webp` — one set per language; the handbook swaps images with its language toggle (no more inline base64).
- **Regenerate every screenshot** with `scripts/capture_doc_screenshots.py` (the dev server must be running): Playwright drives the real app flows and every AI endpoint is mocked with `page.route` using illustrative content, so no API key is needed. Options: `--lang`, `--scene`, `--only`. Re-run it whenever the UI changes.

## 3. Running, deploying and distributing

1. **Local dev**: `python app.py` (Werkzeug dev server).
2. **Docker Compose**: `docker compose up --build` (`Dockerfile` + `docker-compose.yml`, image `ai-sem:latest`, gunicorn).
3. **Render.com**: `render.yaml`, service named `ueh-websem` (an internal Render name kept from before the rebrand).
4. **Standalone apps** — Windows and macOS, built with PyInstaller from `desktop_launcher.py`:
   - **Windows**: build locally with `build_exe.bat` (needs a `.venv` with `pyinstaller`) → `dist\AI-SEM.exe` (~285 MB, mostly the ML libraries).
   - **macOS**: PyInstaller can't cross-compile, so it must be built on macOS. Use the GitHub Actions workflow `.github/workflows/build-macos.yml` (runner `macos-latest`), triggered with `gh workflow run build-macos.yml` or by pushing a `v*` tag. The output is an **Actions run artifact** (not a Release), downloaded with `gh run download <run-id> -n AI-SEM-macos` (if that stalls, download the artifact zip through the REST API with curl).
   - Both files (`AI-SEM.exe`, `AI-SEM-macos.zip`) are published to **`ai-sem.com/downloads/`** over SFTP using an account supplied by the owner (credentials are never stored in the repo). Upload approach: install `paramiko` in `.venv` (not in `requirements.txt` — an operations tool, not an app dependency); upload to a temporary `.uploading` name, then `posix_rename`, so a half-uploaded file is never served. The host holds the whole PHP landing site (`ai-sem.com/{admin,assets,data,downloads,includes,test}/...`), completely separate from the Flask app; `downloads/` is the only folder to sync.

## 4. Settled decisions (don't re-ask or reverse without a reason)

- **i18n architecture**: two separate catalogs, not merged. English default. Exported reports follow the UI language at export time.
- **Moderation**: two-stage approach, moderation-specific f² thresholds (Kenny 2018 / Aguinis et al. 2005). Blindfolding/Q² skipped when an interaction exists.
- **The desktop launcher uses the Werkzeug dev server**, not gunicorn (gunicorn doesn't run on Windows).
- **Installers are distributed via `ai-sem.com/downloads/`, never committed to git** — `dist/`, `dist_macos/`, `build/` are in `.gitignore`. (The original `ueh-websem` history still contains one legacy `UEH-WebSEM.exe`; the new `ai-sem` repository starts from a clean history without it.)
- **Worker Pool demographics are always assigned by a real RNG, never chosen by the AI** — decided after finding that AI-chosen demographics were systematically biased and missed the requested proportions even when asked to "balance". Applies to age, gender and every custom attribute in AI Lab Experiment (NOT retrofitted to plain AI Lab, which keeps its original design).
- **Refuse any request to delete/alter data just to change statistical significance** — even when packaged as a feature (an "outlier remover" with N/M parameters run repeatedly) or reframed as "experimental"/"not for a thesis". This research-ethics line has been held in earlier sessions and **must continue to be held**. Legitimate outlier handling (Mahalanobis distance, straight-lining, run once, disclosed, not outcome-driven) remains acceptable.
- **Synthetic data for illustration/user guides is acceptable** — as long as it is clearly disclosed as synthetic, not a real survey, and produced with the software's own simulation methods.
- **PLS-MGA**: each group needs at least ~30 observations; moderation models only with two-stage interactions.

## 5. CI & test suite

- **`tests/`**: 21 test files, 304 test cases, run with `pytest`. Covers every major API route including the AI features (provider calls are always mocked at `_call_openai`/`_call_gemini`/`_call_claude`; tests never call a real API).
- **`.github/workflows/tests.yml`**: runs pytest on every push/PR to `main`.
- **`.github/workflows/build-macos.yml`**: builds the macOS app on demand (`workflow_dispatch`) or on a `v*` tag.
- Always run `.venv/Scripts/python.exe -m pytest -q` before committing any back-end change.

## 6. Open items / caveats

- **Not implemented**: Consistent PLS (PLSc), full MIMIC/formative support in CB-SEM.
- **Plain AI Lab does not yet use RNG-assigned demographics** like AI Lab Experiment — if users report skewed gender/age in plain AI Lab data, that's the known cause; the same technique can be applied.
- The dummy-variable dialog also lists numeric Likert columns (they have ≤ 12 distinct values); listing text columns first would make it easier to use.
- `docs/UEH-WebSEM_Sach_Huong_Dan.docx` is a legacy Vietnamese user manual from before the rebrand; the HTML guides in `static/docs/` are the maintained documentation.

## 7. Quick reference

| Need | Where |
|---|---|
| Core PLS-SEM algorithm | `pls/algorithm.py` |
| Moderation (PLS / CB-SEM) | `pls/moderation.py`, `cbsem/moderation.py` |
| PLS-MGA | `pls/mga.py`, `routes/mga_api.py` |
| Total/indirect effects (mediation) | `pls/effects.py` |
| Sensitivity (shrink/resample/p-value/export-row) | `routes/sensitivity_api.py`, `static/js/sensitivity.js` |
| AI Lab (one-pass generation) | `routes/ai_data_gen_api.py` |
| AI Lab Experiment (Worker Pool + survey) | `routes/ai_worker_api.py` |
| AI rater for qualitative answers | `routes/ai_qual_score_api.py` |
| Dummy variables | `routes/dummy_api.py` |
| Session save/restore | `saveSession()`/`restoreSession()` in `static/js/app.js` |
| i18n back end / front end | `i18n.py` / `static/js/i18n.js` |
| Excel/Word export | `pls/report.py`, `cbsem/report.py` |
| Model builder canvas | `static/js/diagram.js` |
| Desktop launcher | `desktop_launcher.py`, `build_exe.bat`, `.github/workflows/build-macos.yml` |
| User documentation | `static/docs/user_guide_{en,vi}.html`, `static/docs/handbook.html` |
| Screenshot regeneration | `scripts/capture_doc_screenshots.py` |
| Test suite | `tests/` (`pytest`), CI: `.github/workflows/tests.yml` |
