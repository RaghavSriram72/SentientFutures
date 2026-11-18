"""Publishing the public site from admin ("Publish to site").

The public site is a static export on GitHub Pages, built from a data folder
(shared/sf_shared/export_site.py). Approving a source or saving a milestone or
post changes the database, not the site. The site changes when it's rebuilt:
every night, on every push to main, and when someone presses Publish.

    POST /api/site/publish   start a rebuild
    GET  /api/site/publish   the last publish, and what has changed since

Two modes:

    github  the API asks GitHub to run .github/workflows/deploy-site.yml,
            which exports from this API (the repo variable API_URL) and
            deploys. Needs GITHUB_TOKEN (with Actions: write) and GITHUB_REPO.
    local   with an in-memory database, or without GITHUB_TOKEN, nothing is
            sent anywhere. The answer carries the command that builds the
            site from this API on this machine.

Each press inserts a site_publishes document (insert-only), whatever the mode.
"""

import uuid
from collections.abc import Callable

import httpx
from flask import Blueprint, jsonify, request

from sf_api.app_state import app_config, app_db
from sf_api.auth import current_user
from sf_api.config import Config
from sf_api.documents import from_document, to_document
from sf_api.errors import ApiError
from sf_api.runner import GitHubError, dispatch_github_workflow
from sf_shared.db import now
from sf_shared.editor_models import SitePublish
from sf_shared.pipeline_models import ReviewStatus

blueprint = Blueprint("site", __name__, url_prefix="/api/site")

DEPLOY_WORKFLOW = "deploy-site.yml"


def publish_mode(config: Config) -> str:
    """"github" when this server can start the deploy, otherwise "local"."""
    if config.db_in_memory or config.github_token is None or config.github_repo is None:
        return "local"
    return "github"


def local_command(api_url: str) -> str:
    """What to run from frontend/ to see the published data on this machine."""
    return (
        f"../.venv/bin/python -m sf_shared.export_site --content ../content --api {api_url} --out ../.site-data"
        " && DATA_DIR=../.site-data npm run dev"
    )


def this_api_url() -> str:
    return request.host_url.rstrip("/")


def new_publish_id() -> str:
    """e.g. publish-20261027-183000-1a2b3c"""
    return "publish-" + now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]


def publish_json(document: dict | None) -> dict | None:
    if document is None:
        return None
    result = from_document(document)
    # Emails stay in the database.
    result.pop("requested_by", None)
    return result


# ---------- What has changed since the last publish ----------


def last_publish(db) -> dict | None:
    """The newest publish that went out (or, locally, was asked for). Failed ones don't count."""
    return db["site_publishes"].find_one(
        {"github_status": {"$in": ["dispatched", "not_sent"]}},
        sort=[("requested_at", -1)],
    )


def milestone_is_public(revision: dict) -> bool:
    """Whether the site shows the milestone as this revision saved it. Samples never show."""
    return revision.get("published") is True and revision["milestone"].get("sample") is not True


def post_is_public(revision: dict) -> bool:
    """Whether the site shows the post as this revision saved it."""
    return revision["post"].get("status") == "published"


def newest_revision(collection, filters: dict) -> dict | None:
    return collection.find_one(filters, sort=[("saved_at", -1), ("version", -1)])


def count_saved_since(collection, id_field: str, since, is_public: Callable[[dict], bool]) -> int:
    """How many records the next publish would change on the site.

    A record counts when it got a revision since then (the in-memory seed
    doesn't count) and the site shows it now, or showed it at the last
    publish. So a draft that has never been public doesn't count, and a
    published record moved back to draft does, because publishing takes it
    off the site. Before the first publish, "showed it" means as seeded.

    A post can only be renamed while it has never been published, so the
    revisions under its old slug are all drafts and don't count.
    """
    filters: dict = {"action": {"$ne": "seed"}}
    if since is not None:
        filters["saved_at"] = {"$gt": since}
    ids = set()
    for revision in collection.find(filters, projection={id_field: 1}):
        ids.add(revision[id_field])

    count = 0
    for record_id in ids:
        latest = newest_revision(collection, {id_field: record_id})
        before_filters: dict = {id_field: record_id}
        if since is not None:
            before_filters["saved_at"] = {"$lte": since}
        else:
            before_filters["action"] = "seed"
        before = newest_revision(collection, before_filters)
        if latest is not None and is_public(latest):
            count += 1
        elif before is not None and is_public(before):
            count += 1
    return count


def count_approved_since(db, since) -> int:
    """Approved sources whose current approval was made since then."""
    review_ids = []
    for source in db["sources"].find(
        {"review_status": ReviewStatus.APPROVED.value}, projection={"current_review_id": 1}
    ):
        if source.get("current_review_id") is not None:
            review_ids.append(source["current_review_id"])
    filters: dict = {"_id": {"$in": review_ids}, "decision": "approve"}
    if since is not None:
        filters["created_at"] = {"$gt": since}
    return db["reviews"].count_documents(filters)


def waiting_counts(db, since) -> dict:
    return {
        "sources_approved": count_approved_since(db, since),
        "milestones_saved": count_saved_since(db["milestone_revisions"], "milestone_id", since, milestone_is_public),
        "posts_saved": count_saved_since(db["post_revisions"], "post_slug", since, post_is_public),
    }


# ---------- Routes ----------


@blueprint.get("/publish")
def publish_status():
    db = app_db()
    config = app_config()
    last = last_publish(db)
    latest_attempt = db["site_publishes"].find_one(sort=[("requested_at", -1)])
    since = None
    if last is not None:
        since = last["requested_at"]
    mode = publish_mode(config)
    return jsonify(
        {
            "last_publish": publish_json(last),
            "latest_attempt": publish_json(latest_attempt),
            "waiting": waiting_counts(db, since),
            "mode": mode,
            "command": local_command(this_api_url()) if mode == "local" else None,
        }
    )


@blueprint.post("/publish")
def publish_site():
    db = app_db()
    config = app_config()
    user = current_user()
    mode = publish_mode(config)

    github_status = "not_sent"
    error_message = None
    if mode == "github":
        try:
            dispatch_github_workflow(config, DEPLOY_WORKFLOW, {})
            github_status = "dispatched"
        except (GitHubError, httpx.HTTPError) as error:
            github_status = "failed"
            error_message = f"GitHub didn't start the deploy: {error}"

    publish = SitePublish(
        id=new_publish_id(),
        requested_by=user["email"],
        requested_by_name=user["name"],
        requested_at=now(),
        mode=mode,
        github_status=github_status,
        error=error_message,
    )
    document = to_document(publish)
    db["site_publishes"].insert_one(document)

    if github_status == "failed":
        raise ApiError(502, "github_error", error_message, {"publish_id": document["_id"]})

    body = {
        "publish": publish_json(document),
        "mode": mode,
        "command": local_command(this_api_url()) if mode == "local" else None,
    }
    if mode == "github":
        # GitHub has the request; the deploy itself takes a few minutes.
        return jsonify(body), 202
    return jsonify(body), 200
