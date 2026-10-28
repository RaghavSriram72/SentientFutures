"""Starting a pipeline run from the admin dashboard ("Run now").

PIPELINE_RUNNER picks how:

    local   Flask runs the pipeline itself, in a background thread, against
            the same database. The default in development, and the only way an
            in-memory database is shared with the pipeline.
    github  Flask asks GitHub to start .github/workflows/pipeline.yml, which
            runs the pipeline on GitHub's machines. Used in production, where
            the same workflow also runs on a weekly schedule.

Either way the run document is created here first, with status "queued", so
the API can return its id straight away. The pipeline gets that id (run_id)
and fills in the same document as it goes.

Only one run happens at a time. A queued or running run counts as going until
it shows no sign of life for 10 minutes; after that it's marked failed so a
new one can start. That check runs whenever the dashboard reads runs, so a
run that died without finishing (a server restart, a GitHub job that failed
before Python started) stops showing as going.
"""

import logging
import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx
from pymongo.errors import DuplicateKeyError
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from sf_api.config import Config
from sf_api.documents import as_utc, to_document
from sf_api.errors import ApiError
from sf_shared.db import now
from sf_shared.pipeline_models import PipelineRun

log = logging.getLogger(__name__)

ACTIVE_STATUSES = ("queued", "running")
STALE_AFTER = timedelta(minutes=10)

# The start lock: one document in the locks collection (see start_lock).
LOCKS_COLLECTION = "locks"
START_LOCK_ID = "start_run"
# Starting a run takes well under a second. The expiry only matters when a
# server dies while it holds the lock, so it's long enough to never cut off
# a slow database call and short enough that nobody waits long.
START_LOCK_EXPIRES = timedelta(seconds=60)

WORKFLOW_FILE = "pipeline.yml"
GITHUB_API = "https://api.github.com"
GITHUB_TIMEOUT_SECONDS = 15.0


@dataclass(frozen=True)
class RunRequest:
    stages: list[str]  # "collect", "triage", in that order
    limit: int | None
    dry_run: bool
    requested_by: str  # the signed-in user's email (stays in the database)


# ---------- Which runs are going ----------


def last_sign_of_life(run: dict) -> datetime:
    moment = run.get("heartbeat_at") or run["started_at"]
    return as_utc(moment)


def is_stale(run: dict, at: datetime) -> bool:
    return at - last_sign_of_life(run) > STALE_AFTER


def find_active_run(db) -> dict | None:
    """The newest queued or running run that's still sending heartbeats, if any."""
    at = now()
    runs = db["pipeline_runs"].find({"status": {"$in": list(ACTIVE_STATUSES)}}).sort("started_at", -1)
    for run in runs:
        if not is_stale(run, at):
            return run
    return None


def log_line(message: str) -> str:
    """A run log line in the pipeline's format: "18:30:05 message" (UTC)."""
    return f"{now():%H:%M:%S} {message}"


def failed_update(message: str) -> dict:
    return {
        "$set": {"status": "failed", "finished_at": now()},
        "$push": {"errors": message, "log": log_line(message)},
    }


def mark_run_failed(db, run_id: str, message: str) -> None:
    """Fail a run that is still queued or running. A finished run is left alone."""
    db["pipeline_runs"].update_one({"_id": run_id, "status": {"$in": list(ACTIVE_STATUSES)}}, failed_update(message))


def stale_message(run: dict) -> str:
    if run.get("status") == "queued":
        message = "This run was queued but didn't start within 10 minutes, so it was marked failed."
        if run.get("runner") == "github":
            message += " The job's log in the repo's Actions tab on GitHub says why."
        return message
    return "No heartbeat for 10 minutes, so this run was marked failed. It probably crashed or was stopped."


def fail_stale_runs(db) -> None:
    """Mark failed every queued or running run with no sign of life for 10 minutes.

    The pipeline only cleans up runs it marked "running", and a run whose
    process died can't finish its own record, so the API does it too: before
    starting a run, and whenever the dashboard reads runs. Otherwise a run
    that never started would show as queued forever and keep the Start
    button disabled.
    """
    at = now()
    for run in db["pipeline_runs"].find({"status": {"$in": list(ACTIVE_STATUSES)}}):
        if not is_stale(run, at):
            continue
        # The filter repeats what we read, so a run that sent a heartbeat
        # since then is left alone.
        db["pipeline_runs"].update_one(
            {"_id": run["_id"], "status": run["status"], "heartbeat_at": run.get("heartbeat_at")},
            failed_update(stale_message(run)),
        )


# ---------- Starting a run ----------


def new_run_id() -> str:
    """e.g. run-20261027-183000-1a2b3c: sortable by eye, unique enough."""
    return "run-" + now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]


def create_queued_run(db, config: Config, request: RunRequest) -> dict:
    moment = now()
    run = PipelineRun(
        id=new_run_id(),
        trigger="admin",
        runner=config.pipeline_runner,
        requested_by=request.requested_by,
        status="queued",
        stages=request.stages,
        options={"limit": request.limit, "dry_run": request.dry_run},
        started_at=moment,
        heartbeat_at=moment,
        log=[log_line(f"Queued from the admin dashboard ({config.pipeline_runner} runner).")],
    )
    document = to_document(run)
    db["pipeline_runs"].insert_one(document)
    return document


@contextmanager
def start_lock(db) -> Iterator[None]:
    """Let one request at a time check for a going run and create the next one.

    gunicorn runs several worker processes, so a lock in memory isn't enough:
    two clicks that land on different workers could each find no run going
    and each start one. This lock is a document in the database instead.

    Claiming it is one atomic update that only matches when the lock is free
    or its holder died without letting go (expires_at has passed). The first
    time, the upsert creates the document. While someone else holds it, the
    filter matches nothing, so the upsert tries to insert a second document
    with the same _id and MongoDB refuses with DuplicateKeyError.
    """
    holder = uuid.uuid4().hex
    claimed_at = now()
    locks = db[LOCKS_COLLECTION]
    try:
        locks.find_one_and_update(
            {"_id": START_LOCK_ID, "$or": [{"holder": None}, {"expires_at": {"$lt": claimed_at}}]},
            {"$set": {"holder": holder, "expires_at": claimed_at + START_LOCK_EXPIRES}},
            upsert=True,
        )
    except DuplicateKeyError:
        raise ApiError(
            409,
            "run_in_progress",
            "Someone else is starting a run right now. Reload in a moment to see it.",
        ) from None
    try:
        yield
    finally:
        # Matching on the holder means a request that kept the lock past its
        # expiry can't release a lock someone else has claimed since.
        locks.update_one({"_id": START_LOCK_ID, "holder": holder}, {"$set": {"holder": None}})


def start_run(db, config: Config, request: RunRequest) -> dict:
    """Create the run and hand it to the runner. Returns the run document.

    Raises ApiError 409 when a run is already going, 503 when the runner isn't
    set up, and 502 when GitHub refuses to start the workflow.
    """
    with start_lock(db):
        fail_stale_runs(db)
        active = find_active_run(db)
        if active is not None:
            raise ApiError(
                409,
                "run_in_progress",
                "A run is already going. Wait for it to finish, then start another.",
                {"run_id": active["_id"]},
            )

        # Check the runner can start before creating anything, so a setup
        # problem doesn't leave a failed run behind.
        run_pipeline = None
        if config.pipeline_runner == "github":
            check_github_settings(config)
        else:
            run_pipeline = load_run_pipeline()

        run = create_queued_run(db, config, request)

    if run_pipeline is None:
        try:
            dispatch_github_workflow(config, WORKFLOW_FILE, workflow_inputs(run))
        except (GitHubError, httpx.HTTPError) as error:
            message = f"GitHub didn't start the run: {error}"
            mark_run_failed(db, run["_id"], message)
            raise ApiError(502, "github_error", message, {"run_id": run["_id"]}) from None
    else:
        start_local_thread(db, run_pipeline, run)
    return run


# ---------- The local runner ----------


def load_run_pipeline() -> Callable[..., str]:
    """Import the pipeline only when a run starts, so the API (and its tests) work without it."""
    try:
        from sf_pipeline.run import run_pipeline
    except ImportError as error:
        raise ApiError(
            503,
            "pipeline_not_installed",
            "The pipeline package isn't installed on this server. Install it with: pip install -e pipeline",
            {"import_error": str(error)},
        ) from None
    return run_pipeline


def run_in_background(db, run_pipeline: Callable[..., str], run: dict) -> None:
    run_id = run["_id"]
    try:
        returned_id = run_pipeline(
            db,
            stages=run["stages"],
            limit=run["options"].get("limit"),
            dry_run=run["options"].get("dry_run", False),
            trigger="admin",
            runner="local",
            requested_by=run["requested_by"],
            run_id=run_id,
        )
    except Exception as error:
        # RunAlreadyRunning lands here too. The thread has no one to report to,
        # so the error goes on the run, where the dashboard shows it.
        log.exception("Pipeline run %s stopped with an error", run_id)
        mark_run_failed(db, run_id, f"The run stopped with an error: {type(error).__name__}: {error}")
        return

    if returned_id != run_id:
        log.warning("The pipeline returned run id %s, expected %s", returned_id, run_id)
    # The pipeline should have finished the run document itself. If it didn't,
    # close it now rather than block new runs for 10 minutes.
    mark_run_failed(db, run_id, "The pipeline returned without finishing this run's record.")


def start_local_thread(db, run_pipeline: Callable[..., str], run: dict) -> threading.Thread:
    # A daemon thread doesn't keep the server alive on shutdown. A run cut off
    # that way stops sending heartbeats and is marked failed 10 minutes later.
    thread = threading.Thread(
        target=run_in_background,
        args=(db, run_pipeline, run),
        name=f"pipeline-{run['_id']}",
        daemon=True,
    )
    thread.start()
    return thread


# ---------- The GitHub runner ----------


class GitHubError(Exception):
    pass


# What usually causes each refusal, so the admin sees the fix, not just a code.
# {workflow} is the workflow file being started.
GITHUB_HINTS = {
    401: "Check that GITHUB_TOKEN is valid and hasn't expired.",
    403: "The token needs the Actions: write permission on this repo.",
    404: "Check GITHUB_REPO, that the token can see the repo, and that .github/workflows/{workflow} exists on the branch.",
    422: "{workflow} needs a workflow_dispatch trigger that accepts the inputs sent.",
}


def check_github_settings(config: Config) -> None:
    missing = []
    if config.github_token is None:
        missing.append("GITHUB_TOKEN")
    if config.github_repo is None:
        missing.append("GITHUB_REPO")
    if len(missing) > 0:
        raise ApiError(
            503,
            "runner_not_configured",
            f"PIPELINE_RUNNER is github, but {' and '.join(missing)} isn't set on the server.",
        )
    if config.github_repo.count("/") != 1:
        raise ApiError(503, "runner_not_configured", 'GITHUB_REPO should look like "owner/SentientFutures".')


def github_client(config: Config) -> httpx.Client:
    return httpx.Client(
        base_url=GITHUB_API,
        timeout=GITHUB_TIMEOUT_SECONDS,
        headers={
            "Authorization": f"Bearer {config.github_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "sentient-futures-api",
        },
    )


# Only failures to connect are retried. Then the request never reached GitHub,
# so retrying can't start the workflow twice.
@retry(
    retry=retry_if_exception_type((httpx.ConnectError, httpx.ConnectTimeout)),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, max=8),
    reraise=True,
)
def send_to_github(client: httpx.Client, method: str, path: str, body: dict | None = None) -> httpx.Response:
    return client.request(method, path, json=body)


def github_message(response: httpx.Response) -> str:
    try:
        return str(response.json().get("message", response.text))
    except ValueError:
        return response.text


def check_github_response(response: httpx.Response, action: str, workflow_file: str) -> None:
    if response.status_code in (200, 201, 204):
        return
    hint = GITHUB_HINTS.get(response.status_code, "").replace("{workflow}", workflow_file)
    message = f"GitHub wouldn't {action} ({response.status_code}: {github_message(response)}). {hint}"
    raise GitHubError(message.strip())


def workflow_inputs(run: dict) -> dict[str, str]:
    """GitHub passes workflow inputs as strings. No emails: Actions logs can be public."""
    limit = run["options"].get("limit")
    dry_run = run["options"].get("dry_run", False)
    return {
        "stages": ",".join(run["stages"]),
        "limit": "" if limit is None else str(limit),
        "dry_run": "true" if dry_run else "false",
        "run_id": run["_id"],
    }


def dispatch_github_workflow(config: Config, workflow_file: str, inputs: dict[str, str]) -> None:
    """Ask GitHub to run .github/workflows/<workflow_file> on GITHUB_BRANCH.

    Used for pipeline.yml ("Run now") and deploy-site.yml ("Publish to site").
    Raises GitHubError when GitHub refuses, with a hint about the usual cause.
    """
    path = f"/repos/{config.github_repo}/actions/workflows/{workflow_file}"
    with github_client(config) as client:
        # GitHub turns off scheduled workflows in public repos after 60 days
        # without activity. Turning it on again is harmless when it's already on.
        response = send_to_github(client, "PUT", f"{path}/enable")
        check_github_response(response, f"turn on {workflow_file}", workflow_file)

        body = {"ref": config.github_branch, "inputs": inputs}
        response = send_to_github(client, "POST", f"{path}/dispatches", body)
        check_github_response(response, f"start {workflow_file}", workflow_file)
