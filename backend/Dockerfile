# The admin API, as DigitalOcean App Platform runs it (see .do/app.yaml).
#
# Build from the repo root, because the API also needs shared/ and pipeline/:
#     docker build -f backend/Dockerfile -t sf-api .
#     docker run --env-file .env -p 8080:8080 sf-api
#
# The image starts in production mode (APP_ENV=production), so it refuses to
# run without JWT_SECRET and a real MONGO_URI.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_ENV=production \
    PORT=8080 \
    CONTENT_DIR=/app/content

WORKDIR /app

# Only the files the server needs, named one by one, so a stray .env or
# local cache in the repo never ends up in the image.
COPY shared/pyproject.toml shared/pyproject.toml
COPY shared/sf_shared shared/sf_shared
COPY pipeline/pyproject.toml pipeline/pyproject.toml
COPY pipeline/sf_pipeline pipeline/sf_pipeline
COPY backend/pyproject.toml backend/wsgi.py backend/
COPY backend/sf_api backend/sf_api
# sources.json: the source catalog and the add-source form check against the
# sources the site already cites, and so does the pipeline's dedupe.
# milestones.json: the local runner's triage prompt lists the milestones
# until they're imported into the database.
COPY content/milestones.json content/sources.json content/

# Editable installs keep each package where it sits in the repo layout, which
# is how the pipeline finds content/ when CONTENT_DIR isn't set. The pipeline
# is only used with PIPELINE_RUNNER=local, but it's small, so it's included.
RUN pip install -e ./shared -e ./pipeline -e ./backend

RUN useradd --create-home --uid 1000 api
USER api

WORKDIR /app/backend
EXPOSE 8080

# 2 workers with 4 threads each fits the $5 instance (512 MB). No --preload:
# each worker opens its own MongoDB connection after gunicorn forks it, since
# pymongo clients aren't safe to share across a fork.
CMD exec gunicorn --bind "0.0.0.0:${PORT}" --workers 2 --threads 4 --timeout 60 --access-logfile - --error-logfile - wsgi:app
