from __future__ import annotations

import os

from flask import Flask, render_template

from routes.api import api
from routes.cbsem_api import cbsem_api
from routes.plspredict_api import plspredict_api
from routes.sensitivity_api import sensitivity_api

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def create_app() -> Flask:
    app = Flask(__name__)
    # Overridable via env var for the packaged desktop .exe: PyInstaller's
    # onefile mode extracts the app to a temp directory that's wiped on exit,
    # so uploads must live somewhere persistent instead (see desktop_launcher.py).
    app.config["UPLOAD_DIR"] = os.environ.get("WEBSEM_UPLOAD_DIR") or os.path.join(BASE_DIR, "uploads")
    app.config["SAMPLE_DIR"] = os.path.join(BASE_DIR, "sample_data")
    app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20 MB
    app.register_blueprint(api)
    app.register_blueprint(cbsem_api)
    app.register_blueprint(sensitivity_api)
    app.register_blueprint(plspredict_api)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/sensitivity")
    def sensitivity_page():
        return render_template("sensitivity.html")

    return app


app = create_app()

if __name__ == "__main__":
    # Local development only. In production a WSGI server (gunicorn) imports
    # the `app` object above directly and never runs this block — debug mode
    # (which enables the Werkzeug debugger's arbitrary code execution) must
    # never be reachable when the app is exposed on the internet.
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=debug, host="127.0.0.1", port=port)
