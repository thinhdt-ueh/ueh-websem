"""Process pool for embarrassingly parallel simulation work (Monte Carlo
power analysis replicates).

Python runs one thread of numeric work at a time per process (the GIL), so
a simulation looping in one process uses a single core -- ~8% of a 12-thread
machine. Each Monte Carlo replicate is independent, so they are farmed out
to a pool of worker processes instead.

- One pool per server process, created lazily and reused across requests
  (spawning workers costs a few seconds of imports on Windows/macOS).
- Defaults to all logical CPUs but one, leaving a core for the web server
  and the browser; WEBSEM_WORKERS overrides it (1 = run in-process, which
  is also the fallback if a pool cannot be started).
- An idle pool (no simulation for IDLE_SHUTDOWN_SECONDS) is shut down to
  hand its memory (~80 MB per worker) back; the next run starts a new one.
- Each worker pins its BLAS to one thread: the matrices here are tiny, so
  BLAS threading only adds contention once every core already runs a worker.
"""

from __future__ import annotations

import multiprocessing
import os
import threading
import time
from contextlib import contextmanager
from concurrent.futures import ProcessPoolExecutor

_BLAS_THREAD_VARS = ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS")

IDLE_SHUTDOWN_SECONDS = 600

_lock = threading.Lock()
_executor: ProcessPoolExecutor | None = None
_active_runs = 0
_last_used = 0.0
_reaper_started = False


def worker_count() -> int:
    override = os.environ.get("WEBSEM_WORKERS", "").strip()
    if override.isdigit() and int(override) > 0:
        return int(override)
    return max(1, (os.cpu_count() or 2) - 1)


def _init_worker() -> None:
    try:
        from threadpoolctl import threadpool_limits

        threadpool_limits(1)
    except ImportError:
        pass


def get_executor() -> ProcessPoolExecutor | None:
    """The shared pool, or None when work should run in the calling thread
    (WEBSEM_WORKERS=1, or a pool can't be started on this platform)."""
    global _executor
    if worker_count() <= 1:
        return None
    with _lock:
        if _executor is None:
            # Workers are spawned lazily (on first submit) and inherit the
            # environment then, reading these before numpy loads its BLAS.
            # This process's BLAS is already initialized, so setting them
            # here leaves the server itself unaffected.
            for var in _BLAS_THREAD_VARS:
                os.environ[var] = "1"
            try:
                # "spawn" everywhere: fork()ing a multi-threaded web server
                # process (Linux's default) can deadlock in the child.
                _executor = ProcessPoolExecutor(
                    max_workers=worker_count(), initializer=_init_worker,
                    mp_context=multiprocessing.get_context("spawn"),
                )
            except (OSError, NotImplementedError, PermissionError, ValueError):
                return None
        return _executor


@contextmanager
def executor_session():
    """The executor (or None = run inline) for one simulation run; marks the
    pool busy meanwhile so the idle reaper never shuts it down under a
    running job."""
    global _active_runs, _last_used
    executor = get_executor()
    with _lock:
        _active_runs += 1
        _start_reaper()
    try:
        yield executor
    finally:
        with _lock:
            _active_runs -= 1
            _last_used = time.monotonic()


def _start_reaper() -> None:
    global _reaper_started
    if _reaper_started:
        return
    _reaper_started = True

    def reap():
        global _executor
        while True:
            time.sleep(60)
            with _lock:
                idle = _active_runs == 0 and time.monotonic() - _last_used > IDLE_SHUTDOWN_SECONDS
                if idle and _executor is not None:
                    _executor.shutdown(wait=False, cancel_futures=True)
                    _executor = None

    threading.Thread(target=reap, daemon=True, name="websem-pool-reaper").start()


def reset_executor() -> None:
    """Drops a pool whose worker died (BrokenProcessPool) so the next call
    starts a fresh one."""
    global _executor
    with _lock:
        if _executor is not None:
            _executor.shutdown(wait=False, cancel_futures=True)
            _executor = None
