"""Routes anyone can read, without signing in. Only approved, reviewed or published data goes out here.

The publish step (shared/sf_shared/export_site.py) reads all three when it
builds the site's data folder. Each one leaves out a record that doesn't
validate and lists it under "skipped" with its problems, so one bad record
never blocks the rest.
"""

from flask import Blueprint, jsonify

from sf_api.app_state import app_config, app_db
from sf_api.documents import iso
from sf_api.milestones import is_live, public_milestones
from sf_api.posts import public_posts
from sf_api.publish import approved_public_sources
from sf_shared.db import now
from sf_shared.enums import RUBRIC_VERSION

blueprint = Blueprint("public", __name__, url_prefix="/api/public")


@blueprint.get("/sources")
def public_sources_route():
    """Approved sources in the public Source shape."""
    sources, skipped = approved_public_sources(app_db())
    return jsonify(
        {
            "sources": sources,
            "skipped": skipped,
            "rubric_version": RUBRIC_VERSION,
            "generated_at": iso(now()),
        }
    )


@blueprint.get("/milestones")
def public_milestones_route():
    """Published milestones in the public Milestone shape, in list order.

    collection_live is false until milestones have been imported into the
    database. Until then the publish step keeps using content/milestones.json.
    Sample milestones are included with their sample flag; the site hides them.
    """
    db = app_db()
    milestones, skipped = public_milestones(db, app_config().content_dir)
    return jsonify(
        {
            "milestones": milestones,
            "skipped": skipped,
            "collection_live": is_live(db),
            "generated_at": iso(now()),
        }
    )


@blueprint.get("/posts")
def public_posts_route():
    """Published posts, newest first: {slug, title, date, author, summary, body}."""
    posts, skipped = public_posts(app_db())
    return jsonify({"posts": posts, "skipped": skipped, "generated_at": iso(now())})
