"""Entry point for the packaged desktop launcher (see build_exe.bat for
Windows, build_macos.sh / .github/workflows/build-macos.yml for macOS).

Runs the Flask app locally with Werkzeug's built-in server — appropriate here
because the app only ever listens on 127.0.0.1 for a single local user, unlike
the gunicorn-based Procfile/Dockerfile used for actual internet-facing
deployment (gunicorn itself doesn't run on Windows, and isn't needed for a
single local user on macOS either). Opens the default browser to the app once
the server is confirmed to be accepting connections, and keeps uploaded data
in a persistent per-user folder instead of PyInstaller's onefile temp
extraction directory, which is deleted when the process exits.
"""

from __future__ import annotations

import logging
import os
import socket
import sys
import threading
import time
import webbrowser

HOST = "127.0.0.1"
PORT = 5000


def _persistent_upload_dir() -> str:
    if sys.platform == "darwin":
        root = os.path.expanduser("~/Library/Application Support")
    else:
        root = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    path = os.path.join(root, "AI-SEM", "uploads")
    os.makedirs(path, exist_ok=True)
    return path


def _wait_for_server(host: str, port: int, timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def _open_browser_when_ready():
    if _wait_for_server(HOST, PORT):
        webbrowser.open(f"http://{HOST}:{PORT}/")


def main():
    os.environ.setdefault("WEBSEM_UPLOAD_DIR", _persistent_upload_dir())
    os.environ["FLASK_DEBUG"] = "0"
    os.environ["PORT"] = str(PORT)

    # Imported after the env vars above are set, since app.py reads
    # WEBSEM_UPLOAD_DIR at import time (create_app() runs at module load).
    from app import app

    threading.Thread(target=_open_browser_when_ready, daemon=True).start()

    # Werkzeug's own startup banner ("WARNING: This is a development
    # server...") and per-request access log both log at INFO through the
    # "werkzeug" logger -- appropriate noise for local web development, but
    # this is the packaged offline desktop build, so it just makes the
    # finished product's console window look like an unfinished test run.
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    # Flask's own " * Serving Flask app '...'" / " * Debug mode: off" lines
    # are printed directly via click.echo (not through logging), so the
    # logger-level change above doesn't touch them -- silence them the same
    # documented way Flask deployment guides do.
    import flask.cli
    flask.cli.show_server_banner = lambda *args, **kwargs: None

    print(f"AI-SEM is starting at http://{HOST}:{PORT}/")
    print("Closing this window will stop the server.")
    try:
        app.run(host=HOST, port=PORT, debug=False, use_reloader=False)
    except OSError as exc:
        print(f"Could not start the server (is port {PORT} already in use?): {exc}")
        input("Press Enter to exit...")
        sys.exit(1)


if __name__ == "__main__":
    main()
