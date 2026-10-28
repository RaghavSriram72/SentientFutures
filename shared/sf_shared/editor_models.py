"""The documents behind the admin editors for milestones and blog posts.

They live in MongoDB next to the pipeline's collections (pipeline_models.py):

    milestones            one doc per milestone: the public Milestone fields
                          from models.py plus MILESTONE_EDITOR_FIELDS. _id is
                          the milestone id.
    milestone_revisions   a full copy of a milestone at every save. Insert-only.
    posts                 one doc per blog post (StoredPost). _id is the slug.
    post_revisions        a full copy of a post at every save. Insert-only.
    site_publishes        one doc each time someone presses "Publish to site".
                          Insert-only.

Once milestones and posts are imported, MongoDB is where they're edited.
content/milestones.json and content/posts/ stay in git as the seed data and
the offline fixture for CI. The public site gets the published ones through
the publish step (export_site.py), in the same shapes as content/.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

# What a milestone document holds besides the public Milestone fields. The
# public export leaves these out.
#   published        only published milestones reach the site
#   version          goes up by one on every save; a save must name the
#                    version it started from, so two editors can't overwrite
#                    each other without noticing
#   position         the order milestones are listed in (content/milestones.json order)
#   updated_by       email of whoever saved it last (never exported)
#   updated_by_name  their display name, for the admin list
#   updated_at       when
MILESTONE_EDITOR_FIELDS = ("published", "version", "position", "updated_by", "updated_by_name", "updated_at")

# Who saved a revision. "seed" is the in-memory database filling itself from
# content/ when the API starts, "import" is the CLI, the rest are admin saves.
RevisionAction = Literal["seed", "import", "create", "update"]

PostStatus = Literal["draft", "published"]


class MilestoneRevision(BaseModel):
    """A milestone exactly as it was saved. Insert-only, so every earlier version stays readable."""

    model_config = ConfigDict(extra="forbid")

    id: str
    milestone_id: str
    version: int
    published: bool
    action: RevisionAction
    milestone: dict  # the public Milestone fields as saved
    saved_by: str  # email (never exported)
    saved_by_name: str
    saved_at: datetime


class StoredPost(BaseModel):
    """A blog post as the editor keeps it. The frontmatter fields match PostFrontmatter in models.py."""

    model_config = ConfigDict(extra="forbid")

    slug: str  # fixed once the post has been published, because it's the post's URL
    title: str
    date: str  # YYYY-MM-DD
    author: str
    summary: str
    body: str  # Markdown
    status: PostStatus
    published_at: datetime | None = None  # the first time it was marked published
    version: int
    updated_by: str | None = None  # email (never exported)
    updated_by_name: str | None = None
    updated_at: datetime


class PostRevision(BaseModel):
    """A post exactly as it was saved. Insert-only."""

    model_config = ConfigDict(extra="forbid")

    id: str
    post_slug: str
    version: int
    action: RevisionAction
    post: dict  # the StoredPost fields as saved
    previous_slug: str | None = None  # set when this save renamed a draft
    saved_by: str
    saved_by_name: str
    saved_at: datetime


class SitePublish(BaseModel):
    """One press of "Publish to site". Insert-only.

    mode "github" asked GitHub to run deploy-site.yml (github_status says
    whether GitHub took the request). mode "local" sent nothing: the API
    answered with the command that builds the site on this machine.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    requested_by: str  # email (never exported)
    requested_by_name: str
    requested_at: datetime
    mode: Literal["github", "local"]
    github_status: Literal["dispatched", "failed", "not_sent"]
    error: str | None = None


__all__ = [
    "MILESTONE_EDITOR_FIELDS",
    "MilestoneRevision",
    "PostRevision",
    "PostStatus",
    "RevisionAction",
    "SitePublish",
    "StoredPost",
]
