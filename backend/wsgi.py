"""Entry point for gunicorn: `gunicorn wsgi:app` from the backend folder.

Settings come from environment variables (see .env.example at the repo root).
"""

import logging

from sf_api import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = create_app()
