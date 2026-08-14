FROM python:3.12-slim

WORKDIR /app

# Keeps pip from writing .pyc files and buffers stdout (so `docker logs` shows
# Flask/gunicorn output immediately instead of batching it).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

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

CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "120"]
