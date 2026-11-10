"""Run-size limits for the long simulations (power analysis, sensitivity).

The hosted web app keeps budget caps so one request cannot occupy a shared
server for hours. A local installation -- the desktop app, `python app.py`,
or the batch command line (python -m pls.batch) -- runs on the user's own
machine, so the caps are lifted there: AISEM_LOCAL=1 enables that mode
(desktop_launcher.py and app.py set it; Docker/gunicorn deployments do not).
"""

from __future__ import annotations

import os

HOSTED_MAX_POWER_FITS = 250_000
HOSTED_MAX_SENSITIVITY_FITS = 15_000
HOSTED_MAX_REPLICATES = 500
LOCAL_MAX_REPLICATES = 10_000


def local_mode() -> bool:
    return os.environ.get("AISEM_LOCAL", "").strip().lower() in ("1", "true", "yes")


def power_fit_cap() -> int | None:
    """Most PLS fits (replicates x (1 + bootstraps) over all sizes) one power run may need; None = no cap."""
    return None if local_mode() else HOSTED_MAX_POWER_FITS


def sensitivity_fit_cap() -> int | None:
    return None if local_mode() else HOSTED_MAX_SENSITIVITY_FITS


def max_replicates() -> int:
    """Most Monte Carlo replicates / subsamples per size."""
    return LOCAL_MAX_REPLICATES if local_mode() else HOSTED_MAX_REPLICATES


HOSTED_MAX_BOOTSTRAP = 5_000
LOCAL_MAX_BOOTSTRAP = 100_000


def max_bootstrap_samples() -> int:
    return LOCAL_MAX_BOOTSTRAP if local_mode() else HOSTED_MAX_BOOTSTRAP
