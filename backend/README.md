# Admin API

The Flask app behind the admin pages. It handles sign-in, the review queue, reviews, adding sources by hand, starting pipeline runs, the search config, the milestone and blog post editors, and "Publish to site". It gives the publish step the approved sources, published milestones and published posts. [docs/pipeline-architecture.md](../docs/pipeline-architecture.md) explains how it fits with the pipeline.

## Running it locally

From the repo root, with the venv active:

```
pip install -e shared -e pipeline -e backend
DEV_LOGIN=1 DEV_USERS="you@example.com:Your Name" flask --app sf_api run --port 5050 --debug
```

You get an in-memory database with the default searches already saved, you on the team list, and the milestones and posts from `content/` already imported. Point the admin pages at it with `NEXT_PUBLIC_API_URL=http://localhost:5050` and use the dev sign-in, or get a token by hand:

```
curl -X POST localhost:5050/api/auth/dev -H 'Content-Type: application/json' -d '{"email": "you@example.com"}'
```

The in-memory database is wiped whenever the server restarts, and `--debug` restarts it after every code change. To keep your data, start MongoDB with `docker compose up -d` and add `MONGO_URI=mongodb://localhost:27017` to the run command. DEV_USERS only seeds an in-memory database, so with a real one, add yourself with `flask --app sf_api users add you@example.com "Your Name"`.

When you press "Start the run" on the admin dashboard, this server runs the pipeline in a background thread, against the same database. Without `ANTHROPIC_API_KEY` it still collects papers and skips triage.

Tests: `python -m pytest -q backend/tests`

## Managing the team list

```
flask --app sf_api users add vilija@example.com "Vilija"
flask --app sf_api users list
flask --app sf_api users remove vilija@example.com
flask --app sf_api seed-config          # save the default searches if none are saved
```

These change whatever database `MONGO_URI` points at. Removing someone takes effect on their next request, even if they're signed in.

## Milestones and posts

```
flask --app sf_api content import-milestones ../content/milestones.json   # add --replace to overwrite
flask --app sf_api content import-posts ../content/posts                  # sample-*.md is skipped
flask --app sf_api content export-milestones --out ../content
flask --app sf_api sources flag-missing-abstracts                         # one-off: flag New papers with no abstract
```

Run the imports once against Atlas. After that the team edits milestones and posts in admin, and `content/` is the seed and the offline copy. Each import checks the whole file and saves nothing if anything is invalid.

## How it deploys

DigitalOcean App Platform builds `backend/Dockerfile` from the repo root and runs it with gunicorn on the $5 instance. The spec is `.do/app.yaml`.

1. Check the repo name in `.do/app.yaml`, then run `doctl apps create --spec .do/app.yaml`.
2. In the DigitalOcean dashboard, set `MONGO_URI` (the Atlas connection string for the API's own database user, set up as in [the architecture doc](../docs/pipeline-architecture.md#setting-up-atlas-and-the-claude-console)), `JWT_SECRET` (`openssl rand -hex 32`) and `GITHUB_TOKEN` (a fine-grained token for this repo with Actions: write). Fill in `GOOGLE_CLIENT_ID` there too.
3. From your own machine, with `MONGO_URI` set to Atlas, add the team with `users add`, run `seed-config` once, and import the milestones and posts (above).
4. In the GitHub repo, set the Actions variable `API_URL` to the app's address, so the site's deploy reads what was published in admin.

After that every push to main redeploys. In production "Start the run" asks GitHub to start `pipeline.yml`, the same workflow that runs every week, so the pipeline never runs on the API server. "Publish to site" asks GitHub to start `deploy-site.yml` with the same token.

The server won't start in production if `JWT_SECRET` is missing or shorter than 32 characters, if `DEV_LOGIN` is on, or if `MONGO_URI` is an in-memory database. The error lists every problem at once. Outside production, `DEV_LOGIN` only works with an in-memory database or a MongoDB on your own machine (`mongodb://localhost` or `127.0.0.1`), so a local server pointed at Atlas never lets anyone sign in without Google.

## What the routes return

The route list is in the architecture doc. A few details it leaves out:

- `GET /api/health` also returns `dev_login`, `triage_configured`, `google_client_id` and `db_in_memory`, so the admin pages know which sign-in to offer before anyone signs in. It answers 200 even when the database is down; `ok` and `db` say whether it answered.
- `triage_configured` (in `/api/health` and `/api/pipeline/status`) is `null` with the GitHub runner. The key lives in GitHub's Actions secrets there, so the API can't tell whether triage will run.
- Reading runs (`/api/pipeline/status`, `/api/pipeline/runs` and one run) first marks failed any queued or running run that has shown no sign of life for 10 minutes. A run whose process died can't close its own record, and without this it would show as going forever.
- Starting a run takes a short lock in the `locks` collection, so two requests on different gunicorn workers can't both start one. The loser gets the same 409 `run_in_progress` as when a run is already going.
- `GET /api/pipeline/config` and `PUT` also return `models`, the model ids the pipeline has prices for (`null` if the pipeline package isn't installed). `PUT` refuses a model that isn't one of them, and search text the pipeline can't translate, as `queries[i].text: <why>`.
- `GET /api/reviews/stats` gives, per prompt version, `approval_rate` and `by_ai_relevant`: reviews, approvals and approval rate split by what the AI said (`yes`, `unsure`, `no_spot_check`, `no_rescued`, `no_answer`). Approvals in the two `no` groups are relevant papers the AI would have dropped.
- `GET /api/queue` takes `status` as any review status (default `pending_review`), plus `kind` (what the AI said), `flag`, `q` (title or author), `limit` and `offset`. Each item is `{candidate, assessment}`.
- `POST /api/queue/<id>/review` can include `assessment_id`, the assessment the reviewer was looking at (or `null` for none). If a newer one has arrived since, the review is refused with a 409 so the comparison matches what they saw.
- To change an earlier decision, the review also sends `replaces_review_id`: the id of the source's current review. Without it an approved or rejected source answers 409 `not_reviewable`, and with a stale one it answers 409 `review_changed`.
- The review response includes `publish_problems`: anything that would keep this source off the public site, like a missing year. The approval still counts. `GET /api/public/sources` lists those sources under `skipped` with the same problems.
- `GET /api/queue` also returns `counts`, the number of sources in each status, whatever the filters.
- `POST /api/auth/logout` ends the token it's sent with; it gets a 401 from then on. Tokens issued before sign-out existed (no `jti`) get a 401 too.
- Errors are always `{"error": {"code", "message", "details"}}`. `code` is stable and safe to switch on; `message` is written for people. For validation errors, `details` is a list of `"path: message"` lines.

## Rules the code enforces

Reviews, AI assessments, milestone and post revisions, and site publishes are only ever inserted. `tests/test_insert_only.py` fails if any code in `sf_api/` updates or deletes them.

Approving needs a team-written summary, a known source type, a kind, and at least one technology or "General background". Credibility "unclear" needs a reason other than "other". Rejecting needs a reason. `new`, `pending_review` and `triaged_out` sources can be reviewed; an approved or rejected one only by naming the review it replaces. Every review is kept, and `GET /api/reviews/stats` counts only each source's newest one.

An approval compares all four AI fields whenever the assessment was parsed, and a null or an empty list counts as the AI's answer. A tag the reviewer adds where the AI chose nothing is a change, so the override stats show what the AI misses.

`ai_values_used` has to be true: each field listed must be one where the AI gave a value and the reviewer kept it. The public site marks those fields as AI-suggested.

After a decision the abstract is cleared from the source. The public export never includes emails, notes or abstracts.

A milestone or post save names the version it started from and gets a 409 if someone saved in between. A published milestone can only depend on published ones, and one that published milestones depend on can't be unpublished. A post's slug can't change once it has been published.
