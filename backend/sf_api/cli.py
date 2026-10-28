"""Commands for managing the API from a terminal:

    flask --app sf_api users add raghav@example.com "Raghav Sriram"
    flask --app sf_api users list
    flask --app sf_api users remove raghav@example.com
    flask --app sf_api seed-config            # save the default searches, if none are saved
    flask --app sf_api seed-config --replace  # overwrite the saved searches with the defaults

    flask --app sf_api content import-milestones ../content/milestones.json [--replace]
    flask --app sf_api content export-milestones --out ../content
    flask --app sf_api content import-posts ../content/posts [--replace]
    flask --app sf_api sources flag-missing-abstracts

They use MONGO_URI like the server does, so point it at the database you mean
to change (for production, the Atlas connection string).
"""

import json
from pathlib import Path

import click
from flask import Flask
from flask.cli import AppGroup, with_appcontext

from sf_api.app_state import app_config, app_db
from sf_api.editing import IMPORT_USER, ImportProblems, ImportResult
from sf_api.milestones import import_milestones, public_milestones
from sf_api.posts import import_posts
from sf_api.seed import save_user, seed_search_config
from sf_shared.pipeline_models import ReviewStatus

# AppGroup runs each command inside the app, so app_db() works.
users = AppGroup("users", help="Manage the team list (who can sign in to admin).")


def warn_if_in_memory() -> None:
    if app_config().db_in_memory:
        click.secho(
            "Note: MONGO_URI is an in-memory database, so this change is gone when the command ends. "
            "Set MONGO_URI to change a real database.",
            fg="yellow",
            err=True,
        )


@users.command("add")
@click.argument("email")
@click.argument("name")
def add_user(email: str, name: str) -> None:
    """Add EMAIL to the team list as NAME, or update their name and turn them back on."""
    email = email.strip().lower()
    if "@" not in email:
        raise click.BadParameter(f'"{email}" doesn\'t look like an email address.', param_hint="EMAIL")
    if name.strip() == "":
        message = "The name can't be empty. It's shown on the sources this person reviews."
        raise click.BadParameter(message, param_hint="NAME")
    warn_if_in_memory()
    save_user(app_db(), email, name)
    click.echo(f"{email} can now sign in as {name.strip()}.")


@users.command("list")
def list_users() -> None:
    """Show everyone on the team list."""
    rows = list(app_db()["users"].find().sort("_id", 1))
    if len(rows) == 0:
        click.echo('Nobody yet. Add someone with: flask --app sf_api users add <email> "<name>"')
        return
    for row in rows:
        state = "active" if row.get("active", True) else "removed"
        click.echo(f"{row['_id']}  {row['display_name']}  ({state})")


@users.command("remove")
@click.argument("email")
def remove_user(email: str) -> None:
    """Take EMAIL off the team list. It works at once, even for someone signed in."""
    email = email.strip().lower()
    warn_if_in_memory()
    # Turned off rather than deleted, so `users list` still shows who had access.
    result = app_db()["users"].update_one({"_id": email}, {"$set": {"active": False}})
    if result.matched_count == 0:
        raise click.ClickException(f"{email} isn't on the team list.")
    click.echo(f"{email} can no longer sign in.")


@click.command("seed-config")
@click.option("--replace", is_flag=True, help="Overwrite saved searches with the defaults.")
@with_appcontext
def seed_config(replace: bool) -> None:
    """Save the default search config (DEFAULT_QUERIES in shared/sf_shared/pipeline_models.py)."""
    warn_if_in_memory()
    saved = seed_search_config(app_db(), replace_existing=replace)
    if saved:
        click.echo("Saved the default search config.")
    else:
        click.echo("A search config is already saved, so it was kept. Use --replace to overwrite it.")


# ---------- Milestones and posts ----------

content = AppGroup("content", help="Move milestones and blog posts between content/ and the database.")


def import_failure(error: ImportProblems) -> click.ClickException:
    """Print each problem, and return the error that ends the command."""
    for line in error.problems:
        click.echo(line, err=True)
    return click.ClickException(f"Nothing was imported: {len(error.problems)} problems (listed above).")


def print_import_result(result: ImportResult, what: str) -> None:
    click.echo(f"Added {result.added} {what}, replaced {result.replaced}, kept {result.kept} already there.")
    if result.kept > 0:
        click.echo("Use --replace to overwrite the ones already in the database with the file's version.")


@content.command("import-milestones")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--replace", is_flag=True, help="Overwrite milestones already in the database (each gets a new version).")
def import_milestones_command(path: Path, replace: bool) -> None:
    """Save every milestone in PATH (content/milestones.json) to the database as published.

    After this the database is where milestones are edited. The file stays as
    the seed and the offline fixture; refresh it with export-milestones.
    """
    warn_if_in_memory()
    try:
        records = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise click.ClickException(f"{path} isn't valid JSON (line {error.lineno}: {error.msg}).") from None
    try:
        result = import_milestones(
            app_db(), app_config().content_dir, records, "import", IMPORT_USER, replace_existing=replace
        )
    except ImportProblems as error:
        raise import_failure(error) from None
    print_import_result(result, "milestones")


@content.command("export-milestones")
@click.option(
    "--out",
    "out_dir",
    required=True,
    type=click.Path(file_okay=False, path_type=Path),
    help="The folder to write milestones.json into, e.g. ../content",
)
def export_milestones_command(out_dir: Path) -> None:
    """Write the published milestones to OUT/milestones.json, in the format of content/milestones.json."""
    milestones, skipped = public_milestones(app_db(), app_config().content_dir)
    for item in skipped:
        click.echo(f"Left out {item['id']}: {'; '.join(item['problems'])}", err=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "milestones.json"
    path.write_text(json.dumps(milestones, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    click.echo(f"Wrote {len(milestones)} published milestones to {path}.")


@content.command("import-posts")
@click.argument("folder", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--replace", is_flag=True, help="Overwrite posts already in the database (each gets a new version).")
def import_posts_command(folder: Path, replace: bool) -> None:
    """Save every post in FOLDER (content/posts) to the database as published. sample-*.md files are skipped."""
    warn_if_in_memory()
    try:
        result = import_posts(app_db(), folder, "import", IMPORT_USER, replace_existing=replace)
    except ImportProblems as error:
        raise import_failure(error) from None
    print_import_result(result, "posts")


# ---------- Sources ----------

sources = AppGroup("sources", help="Fix up sources in the database.")


@sources.command("flag-missing-abstracts")
def flag_missing_abstracts() -> None:
    """Flag no_abstract on every source in New that has no abstract.

    Collection sets the flag now. This catches sources collected before it
    did, so the queue's "No abstract" filter finds them. Decided papers are
    left alone: their abstracts were cleared on purpose.
    """
    warn_if_in_memory()
    result = app_db()["sources"].update_many(
        {
            "review_status": ReviewStatus.NEW.value,
            "$or": [{"abstract": None}, {"abstract": ""}],
            "flags": {"$ne": "no_abstract"},
        },
        {"$addToSet": {"flags": "no_abstract"}},
    )
    click.echo(f"Flagged {result.modified_count} sources with no abstract.")


def register_cli(app: Flask) -> None:
    app.cli.add_command(users)
    app.cli.add_command(seed_config)
    app.cli.add_command(content)
    app.cli.add_command(sources)
