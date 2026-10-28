"""Blog posts in MongoDB: checking, saving, importing, and the public copy.

A post is the frontmatter of content/posts/*.md (title, slug, date, author,
summary) plus its Markdown body and a status, "draft" or "published". Every
save checks the same rules the validator applies to content/posts/:

    the frontmatter matches PostFrontmatter (models.py)
    the body has some text
    no em dashes anywhere

then writes it with version + 1, but only if nobody saved it since the editor
opened it (otherwise 409), and inserts a full copy into post_revisions, which
is insert-only.

The slug is the post's address (/blog/<slug>/), so it can change only while
the post has never been published.
"""

from pathlib import Path

from flask import request
from pydantic import BaseModel, ConfigDict, ValidationError
from pymongo.errors import DuplicateKeyError

from sf_api.documents import iso, to_document
from sf_api.editing import ImportProblems, ImportResult, new_revision_id
from sf_api.errors import ApiError, validation_problems
from sf_shared.db import now
from sf_shared.editor_models import PostRevision, PostStatus, RevisionAction, StoredPost
from sf_shared.models import PostFrontmatter
from sf_shared.validate import EM_DASH_FIX, em_dash_line_numbers, parse_frontmatter

TEXT_FIELDS = ("title", "slug", "date", "author", "summary", "body")
# Set by the server. Ignored when a client sends a post back as it got it.
SERVER_FIELDS = ("published_at", "updated_by", "updated_by_name", "updated_at")


class PostBody(BaseModel):
    """What POST /api/posts and PUT /api/posts/<slug> accept.

    Every field is plain text here so a half-written post still parses; the
    rules are checked by post_problems and come back as a 422.
    """

    model_config = ConfigDict(extra="forbid")

    slug: str | None = None  # PUT: leave out to keep the current one
    title: str = ""
    date: str = ""  # YYYY-MM-DD
    author: str = ""
    summary: str = ""
    body: str = ""
    status: PostStatus = "draft"
    version: int | None = None  # PUT: required, the version the editor started from


def read_post_body() -> PostBody:
    """The request body as a PostBody.

    Accepts the post's fields at the top level (the documented shape), or
    nested as {"post": {...}, "version": 3}.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_json", "The request body must be a JSON object.")
    if isinstance(data.get("post"), dict):
        merged = dict(data["post"])
        for key, value in data.items():
            if key != "post":
                merged[key] = value
        data = merged
    fields = {}
    for key, value in data.items():
        if key not in SERVER_FIELDS:
            fields[key] = value
    try:
        return PostBody.model_validate(fields)
    except ValidationError as error:
        raise ApiError(400, "invalid_body", "Some fields aren't valid.", validation_problems(error)) from None


def post_problems(slug: str, body: PostBody) -> list[str]:
    """Every rule the post breaks, one line each, like "summary: must not be empty"."""
    problems: list[str] = []
    frontmatter = {"title": body.title, "slug": slug, "date": body.date, "author": body.author, "summary": body.summary}
    try:
        PostFrontmatter.model_validate(frontmatter)
    except ValidationError as error:
        problems.extend(validation_problems(error))
    if body.body.strip() == "":
        problems.append("body: the post has no text yet")

    values = dict(frontmatter)
    values["body"] = body.body
    for name in TEXT_FIELDS:
        line_numbers = em_dash_line_numbers(values[name])
        if len(line_numbers) == 0:
            continue
        if name == "body":
            lines = ", ".join(str(number) for number in line_numbers)
            problems.append(f"body: has an em dash (line {lines}). {EM_DASH_FIX}")
        else:
            problems.append(f"{name}: has an em dash. {EM_DASH_FIX}")
    return problems


def invalid(problems: list[str]) -> ApiError:
    return ApiError(422, "invalid_post", "Some fields aren't valid.", problems)


def post_json(document: dict) -> dict:
    """A stored post as the admin pages get it (everything but _id)."""
    result = {}
    for key, value in document.items():
        if key != "_id":
            result[key] = value
    return result


def post_document(post: StoredPost) -> dict:
    document = post.model_dump(mode="python")
    document["_id"] = post.slug
    return document


def insert_post_revision(db, post: StoredPost, action: RevisionAction, previous_slug: str | None = None) -> None:
    revision = PostRevision(
        id=new_revision_id(),
        post_slug=post.slug,
        version=post.version,
        action=action,
        post=post.model_dump(mode="python"),
        previous_slug=previous_slug,
        saved_by=post.updated_by or "",
        saved_by_name=post.updated_by_name or "",
        saved_at=post.updated_at,
    )
    db["post_revisions"].insert_one(to_document(revision))


def stored_post(slug: str, body: PostBody, version: int, published_at, user: dict) -> StoredPost:
    return StoredPost(
        slug=slug,
        title=body.title.strip(),
        date=body.date.strip(),
        author=body.author.strip(),
        summary=body.summary.strip(),
        body=body.body,
        status=body.status,
        published_at=published_at,
        version=version,
        updated_by=user["email"],
        updated_by_name=user["name"],
        updated_at=now(),
    )


def version_conflict(current: dict | None) -> ApiError:
    if current is None:
        return ApiError(409, "version_conflict", "This post was renamed or removed after you opened it. Reload the list.")
    details = {
        "current_version": current.get("version"),
        "updated_by_name": current.get("updated_by_name"),
        "updated_at": iso(current["updated_at"]) if current.get("updated_at") else None,
    }
    message = (
        f"This post was saved again after you opened it (by {current.get('updated_by_name')}, "
        f"now version {current.get('version')}). Reload to see that version, then make your change again."
    )
    return ApiError(409, "version_conflict", message, details)


def slug_taken(slug: str) -> ApiError:
    return ApiError(409, "slug_taken", f'A post with the slug "{slug}" already exists. Pick another slug.')


# ---------- Saving ----------


def create_post(db, body: PostBody, user: dict) -> dict:
    slug = (body.slug or "").strip()
    problems = post_problems(slug, body)
    if len(problems) > 0:
        raise invalid(problems)
    if db["posts"].find_one({"_id": slug}, projection={"_id": 1}) is not None:
        raise slug_taken(slug)

    published_at = now() if body.status == "published" else None
    post = stored_post(slug, body, 1, published_at, user)
    try:
        db["posts"].insert_one(post_document(post))
    except DuplicateKeyError:
        raise slug_taken(slug) from None
    insert_post_revision(db, post, "create")
    # Read back, so times come out as stored (MongoDB keeps milliseconds).
    return db["posts"].find_one({"_id": slug})


def save_post(db, slug: str, body: PostBody, user: dict) -> dict:
    existing = db["posts"].find_one({"_id": slug})
    if existing is None:
        raise ApiError(404, "not_found", f"No post with slug {slug}.")
    if body.version is None:
        raise ApiError(400, "version_required", "Send the version you started editing from (version).")
    if body.version != existing.get("version"):
        raise version_conflict(existing)

    new_slug = slug if body.slug is None else body.slug.strip()
    if new_slug != slug and existing.get("published_at") is not None:
        raise invalid(
            [f'slug: can\'t change once the post has been published, because it\'s the post\'s address. Keep "{slug}"']
        )
    problems = post_problems(new_slug, body)
    if len(problems) > 0:
        raise invalid(problems)

    # The first time it's marked published is kept, even if it goes back to draft.
    published_at = existing.get("published_at")
    if published_at is None and body.status == "published":
        published_at = now()
    post = stored_post(new_slug, body, body.version + 1, published_at, user)
    document = post_document(post)

    if new_slug == slug:
        result = db["posts"].replace_one({"_id": slug, "version": body.version}, document)
        if result.matched_count == 0:
            raise version_conflict(db["posts"].find_one({"_id": slug}))
        insert_post_revision(db, post, "update")
        return db["posts"].find_one({"_id": slug})

    # Renaming a draft: the new slug first (it may be taken), then the old one goes.
    try:
        db["posts"].insert_one(document)
    except DuplicateKeyError:
        raise slug_taken(new_slug) from None
    removed = db["posts"].delete_one({"_id": slug, "version": body.version})
    if removed.deleted_count == 0:
        db["posts"].delete_one({"_id": new_slug, "version": post.version})
        raise version_conflict(db["posts"].find_one({"_id": slug}))
    insert_post_revision(db, post, "update", previous_slug=slug)
    return db["posts"].find_one({"_id": new_slug})


# ---------- Importing content/posts/ ----------


def import_posts(
    db,
    posts_dir: Path,
    action: RevisionAction,
    user: dict,
    replace_existing: bool = False,
) -> ImportResult:
    """Save every post in a content/posts-style folder as published.

    Files named sample-*.md are skipped: they're examples for the content
    guide, not posts. Nothing is saved unless every other file is valid. A
    post already in the database is kept unless replace_existing is set.
    """
    if not posts_dir.is_dir():
        raise ImportProblems([f"{posts_dir}/: folder not found"])

    problems: list[str] = []
    ready: list[tuple[str, PostBody]] = []
    for path in sorted(posts_dir.glob("*.md")):
        if path.name.startswith("sample-"):
            continue
        label = str(path)
        errors: list[str] = []
        parsed = parse_frontmatter(path.read_text(encoding="utf-8"), label, errors)
        problems.extend(errors)
        if parsed is None or len(errors) > 0:
            continue
        values = parsed.values
        body = PostBody(
            slug=str(values.get("slug", "")),
            title=str(values.get("title", "")),
            date=str(values.get("date", "")),
            author=str(values.get("author", "")),
            summary=str(values.get("summary", "")),
            body=parsed.body.strip("\n"),
            status="published",
        )
        slug = body.slug or ""
        for line in post_problems(slug, body):
            problems.append(f"{label}: {line}")
        ready.append((slug, body))
    if len(problems) > 0:
        raise ImportProblems(problems)

    result = ImportResult()
    for slug, body in ready:
        existing = db["posts"].find_one({"_id": slug})
        if existing is not None and not replace_existing:
            result.kept += 1
            continue
        version = 1 if existing is None else int(existing.get("version", 0)) + 1
        published_at = now() if existing is None else (existing.get("published_at") or now())
        post = stored_post(slug, body, version, published_at, user)
        db["posts"].replace_one({"_id": slug}, post_document(post), upsert=True)
        insert_post_revision(db, post, action)
        if existing is None:
            result.added += 1
        else:
            result.replaced += 1
    return result


# ---------- The public copy ----------


def public_posts(db) -> tuple[list[dict], list[dict]]:
    """Published posts, newest first, in the shape of content/posts/*.md, and the ones left out."""
    posts = []
    skipped = []
    for document in db["posts"].find({"status": "published"}).sort([("date", -1), ("_id", 1)]):
        body = PostBody(
            slug=document["_id"],
            title=document.get("title", ""),
            date=document.get("date", ""),
            author=document.get("author", ""),
            summary=document.get("summary", ""),
            body=document.get("body", ""),
            status="published",
        )
        problems = post_problems(document["_id"], body)
        if len(problems) > 0:
            skipped.append({"slug": document["_id"], "problems": problems})
            continue
        posts.append(
            {
                "slug": document["_id"],
                "title": body.title,
                "date": body.date,
                "author": body.author,
                "summary": body.summary,
                "body": body.body,
            }
        )
    return posts, skipped
