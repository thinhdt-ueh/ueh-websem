FROM python:3.12-slim

WORKDIR /app

# Keeps pip from writing .pyc files and buffers stdout (so `docker logs` shows
# Flask/gunicorn output immediately instead of batching it).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# libgomp1 is OpenMP's runtime library -- XGBoost and LightGBM's compiled
# extensions link against it and fail with "libgomp.so.1: cannot open shared
# object file" at import time on python:3.12-slim, which doesn't ship it by
# default (unlike the full python:3.12 image or a typical dev machine).
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Uploaded datasets are written here at runtime (see app.py's UPLOAD_DIR) —
# kept as a separate volume mount point in docker-compose.yml so they survive
# container recreation instead of living only in the image's writable layer.
RUN mkdir -p /app/uploads

ENV FLASK_DEBUG=0 \
    PORT=5000
EXPOSE 5000


# --timeout matches Procfile's: Power Analysis / ML Comparison / large
# bootstrap runs are synchronous requests that can legitimately run for
# minutes (see pls/power_analysis.py and ml_compare/engine.py's own budget
# comments) -- a short worker timeout would kill those mid-computation.
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "2400"]
