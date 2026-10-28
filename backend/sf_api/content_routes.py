"""The milestone and blog post editors in admin.

Milestones and posts live in MongoDB once they're imported (see the content
commands in cli.py). These routes are for signed-in team members; the public
site gets the published ones through /api/public/milestones and
/api/public/posts, at the next publish.
"""

from flask import Blueprint, jsonify

from sf_api.app_state import app_config, app_db
from sf_api.auth import current_user
from sf_api.documents import from_document
from sf_api.errors import ApiError, parse_body
from sf_api.milestones import NewMilestoneBody, SaveMilestoneBody, create_milestone, record_json, save_milestone
from sf_api.posts import create_post, post_json, read_post_body, save_post

blueprint = Blueprint("content", __name__, url_prefix="/api")


# ---------- Milestones ----------


@blueprint.get("/milestones")
def list_milestones():
    """Every milestone, published or not, in list order."""
    items = []
    for document in app_db()["milestones"].find().sort([("position", 1), ("_id", 1)]):
        items.append(record_json(document))
    return jsonify({"milestones": items})


@blueprint.post("/milestones")
def new_milestone():
    body = parse_body(NewMilestoneBody)
    document = create_milestone(app_db(), app_config().content_dir, body, current_user())
    return jsonify({"milestone": record_json(document)}), 201


@blueprint.get("/milestones/<milestone_id>")
def get_milestone(milestone_id: str):
    document = app_db()["milestones"].find_one({"_id": milestone_id})
    if document is None:
        raise ApiError(404, "not_found", f"No milestone with id {milestone_id}.")
    return jsonify({"milestone": record_json(document)})


@blueprint.put("/milestones/<milestone_id>")
def put_milestone(milestone_id: str):
    body = parse_body(SaveMilestoneBody)
    document = save_milestone(app_db(), app_config().content_dir, milestone_id, body, current_user())
    return jsonify({"milestone": record_json(document)})


@blueprint.get("/milestones/<milestone_id>/revisions")
def milestone_revisions(milestone_id: str):
    """Every saved version of one milestone, newest first."""
    db = app_db()
    revisions = []
    for revision in db["milestone_revisions"].find({"milestone_id": milestone_id}).sort("saved_at", -1):
        revisions.append(from_document(revision))
    if len(revisions) == 0 and db["milestones"].find_one({"_id": milestone_id}, projection={"_id": 1}) is None:
        raise ApiError(404, "not_found", f"No milestone with id {milestone_id}.")
    return jsonify({"revisions": revisions})


# ---------- Blog posts ----------


@blueprint.get("/posts")
def list_posts():
    """Every post, drafts too, newest date first."""
    items = []
    for document in app_db()["posts"].find().sort([("date", -1), ("_id", 1)]):
        items.append(post_json(document))
    return jsonify({"posts": items})


@blueprint.post("/posts")
def new_post():
    document = create_post(app_db(), read_post_body(), current_user())
    return jsonify({"post": post_json(document)}), 201


@blueprint.get("/posts/<slug>")
def get_post(slug: str):
    document = app_db()["posts"].find_one({"_id": slug})
    if document is None:
        raise ApiError(404, "not_found", f"No post with slug {slug}.")
    return jsonify({"post": post_json(document)})


@blueprint.put("/posts/<slug>")
def put_post(slug: str):
    document = save_post(app_db(), slug, read_post_body(), current_user())
    return jsonify({"post": post_json(document)})
