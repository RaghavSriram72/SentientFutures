# How the source pipeline works

The site needs a steady supply of new papers and posts about brain emulation, brain computer interfaces and neuromorphic AI. Reading every new paper by hand isn't realistic, so a pipeline does the first pass and people make every decision that matters.

It isn't a web crawler. Crawlers click through web pages, which is slow, breaks whenever a site changes, gets blocked, and costs 10 to 20 times more per paper once an AI is reading the pages. Instead the pipeline asks research databases that offer search APIs (arXiv and Semantic Scholar) for papers that match the team's search terms. The code that does the searching is in `pipeline/sf_pipeline/collectors/`, and the team drives all of it from the admin pages at `/admin/`.

## The flow

```
  search_config (edited in admin)
        │
        ▼
  1. COLLECT ── arXiv API ──┐
              ── Semantic ──┤──► normalize ──► dedupe ──► sources: review_status "new"
                 Scholar API┘
        │
        ▼
  2. TRIAGE ── for each "new" source: one Claude call on title + abstract
              ├─ store the call in ai_assessments (insert-only)
              ├─ relevant or unsure ............► "pending_review"
              ├─ not relevant ..................► "triaged_out" (3% are spot-checked: "pending_review")
              ├─ not relevant, quote not found .► "pending_review" with flag quote_mismatch
              └─ refused, failed, invalid ......► "pending_review" with flag ai_failed
        │
        ▼
  3. REVIEW (a person, in /admin/review)
              ├─ approve: writes a review (insert-only), source becomes "approved"
              └─ reject:  writes a review, source becomes "rejected"
        │
        ▼
  4. PUBLISH: at the next site build, approved sources join content/sources.json in the
              data folder the site is built from (see "Publishing the site" below)
```

Every run moves each source one step. If a run crashes halfway, the next run picks up where it stopped, because the state lives on each source, not in the run.

A person can also decide on a paper the AI ruled out (`triaged_out`) or one nobody has triaged yet (`new`), and can change an earlier decision. Changing one adds a new review; the old one stays.

## The parts

| Part | Where | What it does |
|---|---|---|
| Shared models | `shared/sf_shared/pipeline_models.py` | The shape of every database document, used by the pipeline and the API |
| Pipeline | `pipeline/sf_pipeline/` (installed with `pip install -e ./pipeline`) | Collectors, dedupe, triage, the run loop, the gold-set eval |
| API | `backend/sf_api/` (Flask, installed with `pip install -e ./backend`) | Sign-in, the review queue, starting runs, run history, search config, the public export |
| Admin pages | `frontend/app/admin/` and `frontend/components/admin/` | The screens the team uses: dashboard, queue, review, run detail, settings, and the editors for milestones and posts |
| Publish step | `shared/sf_shared/export_site.py` | Builds the data folder the public site is built from (see "Publishing the site") |
| Database | MongoDB (Atlas in production) | The collections listed in `shared/sf_shared/pipeline_models.py` and `shared/sf_shared/editor_models.py` |
| Schedule | `.github/workflows/pipeline.yml` | Runs the pipeline weekly, or when someone starts a run from admin |

## Collect

- **arXiv:** `http://export.arxiv.org/api/query`, at most one request every 3 seconds, one connection. arXiv metadata is CC0, so titles and abstracts can be stored.
- **Semantic Scholar:** the `paper/search/bulk` endpoint, one request a second. It works without a key at a lower limit; set `SEMANTIC_SCHOLAR_API_KEY` for the normal one. Some results have no abstract because of publisher licensing. Those are flagged `no_abstract` when they're collected, so the queue's "No abstract" filter finds them in New, and they're triaged on the title. `flask --app sf_api sources flag-missing-abstracts` adds the flag to papers collected before collection set it.
- Each search in `search_config.queries` runs against the collectors it lists, for papers from the last `lookback_days`. `collectors/query.py` turns the search text (quotes, AND, OR) into each site's own syntax.
- arXiv and Semantic Scholar calls retry with backoff (tenacity) and honour `Retry-After`. A failed collector doesn't stop the other one; the run finishes as `partial`.

**Dedupe** checks, in order: DOI, arXiv id (version stripped), Semantic Scholar id, then the normalized title plus year. A title-only match is flagged `possible_duplicate` instead of dropped, because generic titles collide. Papers the site already cites in `content/sources.json` (not the samples) count as known too.

## Triage

One call per paper to `claude-haiku-5-5` (set in `search_config.model`), at `low` effort with adaptive thinking.

- The instructions live in `pipeline/sf_pipeline/prompts/triage_v1.md`, inside the package so they ship with it. The paper goes in the user message inside `<paper>` tags and is treated as data, never as instructions. A paper that says "rate this highly" gets no say.
- The call is `client.messages.stream`, read to the end with `get_final_message()`, with `output_config.format` set to the JSON schema of `TriageResult`. The pipeline validates the reply itself with Pydantic. It doesn't use `messages.parse`, because in SDK 2.3.0 that raises on a reply that doesn't validate and the raw text and token counts are lost with it.
- The model returns `TriageResult`: relevant (yes, no or unsure), kind (argument or milestone evidence), technology, problem, claim direction, linked milestone ids, and a reason plus an exact quote for each field. No numeric scores. Milestone ids are limited to the real (non-sample) milestones. Every field with a value needs its own reason and quote, and a quote can be at most 300 characters (the same cap as quotes on the public site). An answer that breaks either rule counts as invalid.
- Code checks every quote against the title and abstract (after normalizing whitespace and case). A quote that isn't there gets an ✗ in the review screen. When it's the quote behind a "no", the paper also goes to `pending_review` flagged `quote_mismatch` instead of `triaged_out`, because a paper that's triaged out is rarely seen again.
- A reply that gets cut off is retried once with a larger `max_tokens` (4,000, then 12,000). A reply that doesn't validate is retried once. A refusal isn't retried: it goes straight to a person, flagged `ai_failed`, with the refusal category stored. Anything still unusable after its retry is flagged `ai_failed` too.
- Replies are streamed, so the 60 second timeout is how long the client waits for the next part of a reply, not for all of it. The SDK retries a failed request 4 times. A bad key, a missing permission, an unknown model or an outage that outlasts the retries stops triage for that run, and the papers it didn't reach stay `new`. A 400, a timeout that outlasts the retries, or a reply that breaks off partway marks that one paper `ai_failed` and triage moves on to the next; three in a row stop triage. Tokens used by a call that timed out or broke off aren't reported by the API, so they're missing from the run's cost.
- Every call is stored in `ai_assessments` with the model, prompt version, raw output, parsed result, quote checks, tokens and cost, including calls that got no reply. Nothing ever edits these records, so we can always compare what the AI said with what a person decided. The raw output of an invalid answer is kept too, so if the model quoted more of an abstract than the cap allows, that text stays in the record after the paper's abstract is cleared.
- `prompt_version` is `triage_v1-` plus 8 characters of a sha256 of exactly what the model is sent: the system prompt with the milestones filled in, and the output schema. Editing the prompt or the milestones (in admin once they're imported, otherwise in `content/milestones.json`) gives a new version. Editing only the team notes at the top of the prompt file doesn't, because the model never sees them.
- Limits per run: `max_items_per_run` and `max_cost_usd_per_run`. When a limit is hit, the rest wait for the next run. A model with no price in `pipeline/sf_pipeline/pricing.py` stops triage before any call, so cost is never guessed.
- If an interrupted run already assessed a `new` paper with the current prompt version, the next run reuses that assessment instead of paying for the call again.
- The stage loads its batch of `new` papers once. Before each call it checks that the paper is still `new`, so a paper someone decides from the New tab during a run gets no call, and one decided while its call is running isn't counted as triaged.
- Without `ANTHROPIC_API_KEY`, collection still runs and triage is skipped and logged. The pipeline never invents an AI answer.

Cost: about $0.0006 per paper at current Haiku pricing, so a few dollars a month at 2,000 papers a week.

## Review

The review screen shows three columns for each field: the field, what the AI said (value, reason, quote with its ✓ or ✗), and the final value the reviewer chooses. Final values start empty, with a "Use AI value" button on each field where the AI chose something, so reviewers aren't nudged into agreeing.

Approving needs:

- a team-written summary, because public summaries are always ours;
- a source type (usually filled in from the collector's metadata);
- a kind (an argument, or evidence for a milestone);
- at least one technology, or "General background" (`general_background: true`) for a source about the project as a whole, which goes public with no technology. Both at once is refused.

The rubric ratings (evidence type, directness, independence, relevance, credibility) are optional at this stage. Credibility "unclear" needs a reason (`credibility_unclear_reason`, one of the unclear reasons except "other", since sources have no note field to explain it), and the reason goes to the public source next to the rating. A reason left over after credibility changed to something else is dropped.

Each decision is a new `reviews` document recording the final values, which fields were compared, which the reviewer changed and which AI values they kept. "Compared" means the AI gave a value (not null and not an empty list). Tag lists are compared as sets. A rejection records no comparison, so rejected papers don't skew the override rates. That record is what makes the override rate per field possible: if reviewers keep changing the AI's technology tag, the prompt needs work.

To change a decision, the reviewer opens the paper and presses "Review it again". The form starts from the earlier decision, and the request names the review it replaces (`replaces_review_id`). If that isn't the paper's current review, the API answers 409, so a double click or two people changing it at once can't both count. The override stats use each paper's newest review only.

An approval saves a copy of the final values on the source under `final`. If something the reviewer can't fix would keep it off the public site (a missing year, say), the approval still counts and the API returns those `publish_problems`. The review screen lists them before moving on.

Abstracts are cleared when the AI rules a paper out and after a person decides, since journal abstracts are copyrighted.

## The admin pages

All of them sit behind the sign-in at `/admin/`.

| Page | What it's for |
|---|---|
| `/admin/` | Counts by status (each links to that tab of the queue), "Run the pipeline" with stages, a limit and dry run, the current or last run updating every few seconds, and recent runs |
| `/admin/queue/` | One tab per status, oldest first, 50 at a time with "Show the next 50". Filters for kind (what the AI said), flag and a title or author search |
| `/admin/review/?id=` | One paper: its details, the AI's triage, the field table, the decision form, and the full record of reviews and assessments. After a decision it opens the next paper in the same tab and filters |
| `/admin/runs/?id=` | One run: options, counts, AI usage, errors and the full log (times in UTC) |
| `/admin/settings/` | The searches and the limits, model and effort. Saved with `PUT /pipeline/config` and used from the next run |
| `/admin/sources/new/` | Add a source by hand. It goes to the queue as Pending, marked "Added by hand" |
| `/admin/milestones/`, `/admin/milestones/edit/?id=` | The milestones, and the editor for one (with its history) |
| `/admin/posts/`, `/admin/posts/edit/?slug=` | The blog posts, and the editor for one |

Ids go in the query string because the site is a static export, which can't have a page per paper or per run.

## Running it

There are two ways to run a pipeline, and the admin dashboard works with both.

| | Local (default in development) | GitHub (production) |
|---|---|---|
| Set by | `PIPELINE_RUNNER=local` | `PIPELINE_RUNNER=github` |
| "Start the run" on the admin dashboard | Flask runs the pipeline in a background thread | Flask asks GitHub to start `pipeline.yml` |
| Weekly schedule | none | the cron in `pipeline.yml` (Mondays, 06:17 UTC) |
| Database | `MONGO_URI` (or `mongomock://` for an in-memory one) | Atlas, via the `MONGO_URI` secret |

Either way the API creates the run document first, as `queued`, and hands its id to the pipeline, which fills in the same document. The pipeline only creates indexes on the collections it writes, so in production it can connect as its own database user with no access to `reviews` or `users`. "The database user" in `pipeline/README.md` lists the privileges. Only one run happens at a time. A run that stops sending heartbeats for 10 minutes is marked failed so a new one can start.

`--limit N` caps both stages: at most N papers from each search on each site, and at most N triaged. A dry run still calls arXiv and Semantic Scholar and counts what it would add, but saves no papers, calls no model, and writes only the run document.

From the command line:

```
python -m sf_pipeline.run                     # collect and triage
python -m sf_pipeline.run --stage collect     # just collect
python -m sf_pipeline.run --limit 20 --dry-run
python -m sf_pipeline.eval --gold pipeline/eval/gold_v1.csv --reps 3
```

### Trying the whole thing locally

From the repo root:

```
.venv/bin/pip install -e shared -e pipeline -e backend

# Terminal 1: the API, with an in-memory database, dev sign-in and the local runner
cd backend
MONGO_URI=mongomock://local DEV_LOGIN=1 DEV_USERS="you@example.com:Your Name" PIPELINE_RUNNER=local \
  CORS_ORIGINS="http://localhost:3000" ../.venv/bin/flask --app sf_api run --port 5050

# Terminal 2: the site
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:5050 npm run dev
```

Open `http://localhost:3000/admin/`, sign in with the email from `DEV_USERS`, and start a run with Triage unticked (or set `ANTHROPIC_API_KEY` on the API to triage for real). The in-memory database is wiped when the API restarts. Run `flask` without `--debug` while you're testing, because the reloader restarts it after every code change.

Tests for all three Python packages: `.venv/bin/python -m pytest -q shared pipeline/tests backend/tests` (the `pytest.ini` at the root keeps their fixtures apart).

### Setting up Atlas and the Claude Console

Do these once, before the first production run.

- **Claude Console:** set a monthly spend limit of about $75 (Settings, then Limits). The per-run cost cap on the settings page can go as high as $50, and anyone on the team can start a run from the dashboard, so the per-run cap alone doesn't limit what a month costs. Normal use is a few dollars a month.
- **Atlas network access:** allow access from anywhere (`0.0.0.0/0`). Atlas only accepts addresses on its list, and GitHub's runners don't have fixed ones. With the database open to any address, the passwords and the users' limited roles are what keep it safe.
- **Atlas database users:** make two, one for the API (the `MONGO_URI` set in DigitalOcean) and one for the pipeline (the `MONGO_URI` secret in GitHub). That way a leaked GitHub secret can be revoked without taking the API down. Give each one the `readWrite` role on the `sentient_futures` database only (or the one `MONGO_DB` names), under Specific Privileges when you add the user, instead of Atlas's default "Read and write to any database". Use a long random password, such as the output of `openssl rand -hex 24`. Hex needs no escaping inside the connection string.

The pipeline never reads `users` or writes `reviews`, so a custom role can make its user tighter still. That role needs `createIndex` on `reviews` all the same, because every run calls `ensure_indexes`.

## The admin API

All routes start with `/api`. Everything except `/health`, `/auth/google`, `/auth/dev` and `/public/*` needs `Authorization: Bearer <token>`. Most answers are wrapped in a key, shown below.

| Method and path | What it does |
|---|---|
| `GET /health` | `{ok, db, db_in_memory, git_sha, rubric_version, runner, dev_login, triage_configured, google_client_id}`. Always 200; `ok` and `db` say whether the database answered |
| `POST /auth/google` | `{credential}` from Google sign-in. Checks the token and the team list, returns `{token, expires_at, user}` |
| `POST /auth/dev` | `{email}`. Only when `DEV_LOGIN=1`: signs in someone on the team list without Google, for local development |
| `GET /auth/me` | `{user: {email, name, role}}` |
| `GET /pipeline/status` | `{counts, latest_run, running, active_run_id, runner, triage_configured}`. `counts` is by review status; `triage_configured` means the API server has an Anthropic key |
| `GET /pipeline/runs?limit=20` | `{runs}`, newest first, without their logs |
| `GET /pipeline/runs/<id>` | `{run}`, with its log |
| `POST /pipeline/runs` | Start a run: `{stages: ["collect","triage"], limit?, dry_run?}`. 202 with `{run}`, or 409 if one is already going |
| `GET /pipeline/config` | `{config, saved}`. `saved` is false when the defaults are shown because nothing is saved yet |
| `PUT /pipeline/config` | Replace it (validated with `SearchConfig`, and search labels must be unique). Returns `{config, saved}` |
| `GET /queue?status=pending_review&kind=&flag=&q=&limit=50&offset=0` | `{items: [{candidate, assessment}], total, limit, offset}`, oldest first |
| `GET /queue/<id>` | `{candidate, current_assessment, assessments, reviews}`, newest first |
| `POST /queue/<id>/review` | `{decision, final, ai_values_used, notes, reject_reason?, assessment_id?, replaces_review_id?}`. 201 with `{review, candidate, publish_problems}` |
| `GET /reviews/stats` | Per prompt version and field: how often reviewers changed the AI's value, and to what |
| `GET /public/sources` | `{sources, skipped, rubric_version, generated_at}`: approved sources in the public `Source` shape, for the publish step |
| `GET /public/milestones` | `{milestones, skipped, collection_live, generated_at}`: published milestones in the public `Milestone` shape, in list order. `collection_live` is false until milestones are imported, and the publish step then uses `content/milestones.json` |
| `GET /public/posts` | `{posts, skipped, generated_at}`: published posts as `{slug, title, date, author, summary, body}`, newest first |
| `POST /auth/logout` | Ends the token it's sent with (see "Sign-in"). `{signed_out: true}` |
| `POST /sources` | Add a source by hand: `{url, title, year, authors?, doi?, arxiv_id?, venue?, source_type?, abstract?, note?}`. The year is required because the public source needs one. An arXiv or doi.org link in `url` fills in `arxiv_id` or `doi`. 201 with `{id, candidate}`. 409 `duplicate` with `details: {existing_id, match, where}` when it's already in the database or `content/sources.json` (`match` is `doi`, `arxiv_id` or `title`; `where` is `database` or `site`). 422 `invalid_source` for a bad URL, DOI, arXiv id or year |
| `GET /sources/catalog` | `{sources: [{id, register_id, title, authors, year, url, sample, origin}]}`: every source a milestone can cite, from `content/sources.json` (`origin: "site"`) and approved in admin (`origin: "approved"`) |
| `GET /milestones` | `{milestones}`: every milestone, published or not, in list order. Each is the public `Milestone` fields plus `published`, `version`, `position`, `updated_by`, `updated_by_name`, `updated_at` |
| `POST /milestones` | `{milestone, published?}`. Creates it as a draft unless `published` is true. 201 with `{milestone}`; 409 `id_taken` |
| `GET /milestones/<id>` | `{milestone}` |
| `PUT /milestones/<id>` | `{milestone, version, published}`. `version` is the one the editor started from: if someone saved since, 409 `version_conflict` with `details: {current_version, updated_by_name, updated_at}`. Returns `{milestone}` with the version one higher |
| `GET /milestones/<id>/revisions` | `{revisions}`, newest first: `{id, milestone_id, version, published, action, milestone, saved_by_name, saved_at}`, where `milestone` is the full copy as saved and `action` is `seed`, `import`, `create` or `update` |
| `GET /posts` | `{posts}`: every post, drafts too, newest date first: `{slug, title, date, author, summary, body, status, published_at, version, updated_by, updated_by_name, updated_at}` |
| `POST /posts` | `{slug, title, date, author, summary, body, status?}` (`status` is `draft`, the default, or `published`). 201 with `{post}`; 409 `slug_taken` |
| `GET /posts/<slug>` | `{post}` |
| `PUT /posts/<slug>` | The same fields plus `version`, with the same 409 as milestones. `{"post": {...}, "version": n}` works too. A draft that was never published can change its slug; a published one can't. Returns `{post}` |
| `GET /site/publish` | `{last_publish, latest_attempt, waiting: {sources_approved, milestones_saved, posts_saved}, mode, command}`. `waiting` counts what changed since the last publish; `command` is set in local mode |
| `POST /site/publish` | Publish (see "Publishing the site"). 202 with `{publish, mode: "github", command: null}`, or 200 with `{publish, mode: "local", command}`. 502 `github_error` when GitHub refuses |

`GET /queue` also answers `counts`, the number of sources in each status whatever the filters, so the queue can label its tabs.

`assessment_id` is the assessment the reviewer was looking at. If a newer one has arrived since, the review is refused with a 409. Errors come back as `{error: {code, message, details}}`. For validation errors, `details` is a list of lines like `"queries[0].label: must not be empty"`, which the settings page shows next to the field. A body with the wrong shape is a 400 `invalid_body`. A milestone, post or added source that breaks a content rule is a 422 (`invalid_milestone`, `invalid_post`, `invalid_source`) with the same kind of lines. Milestone lines start with `milestone.`, the key they sit under in the body, like `"milestone.forecasts[0].quote: required ..."`. Post lines start with the field name, like `"summary: must not be empty"`.

## Sign-in

Google sign-in, limited to the emails in the `users` collection (added with `flask --app sf_api users add <email> "<name>"`). Flask checks Google's token and returns its own short-lived token (8 hours), which the admin pages keep in localStorage and send with every request. Cookies don't work here because the public site (github.io) and the API (another domain) are different sites. Each request looks the user up again, so removing someone locks them out at once.

Signing out calls `POST /auth/logout`, which puts the token's id (its `jti`) in `revoked_tokens`. Every request checks that list, so the token stops working at once, even though it hasn't expired. A TTL index deletes each entry when the token would have expired anyway (an in-memory database skips that index; it's emptied on restart). Tokens issued before this existed have no `jti` and get a 401, so those people sign in once more.

For local development, `DEV_LOGIN=1` turns on a plain email sign-in for people on the team list. The API refuses to start in production (`APP_ENV` or `FLASK_ENV` set to production) when `DEV_LOGIN` is on, when `JWT_SECRET` is missing or shorter than 32 characters, or when `MONGO_URI` is an in-memory database.

## Environment variables

`.env.example` at the repo root lists every one with a comment.

| Variable | Used by | Notes |
|---|---|---|
| `MONGO_URI` | pipeline, API | `mongomock://local` for an in-memory database |
| `MONGO_DB` | pipeline, API | Database name, default `sentient_futures` |
| `ANTHROPIC_API_KEY` | pipeline | Triage is skipped without it |
| `SEMANTIC_SCHOLAR_API_KEY` | pipeline | Optional, raises the rate limit |
| `PIPELINE_CONTACT` | pipeline | An email for the User-Agent header that arXiv and Semantic Scholar see |
| `CONTENT_DIR` | pipeline, API | The `content/` folder. The pipeline reads milestones (until they're in the database) and the sources the site already cites. The API reads `sources.json` for the source catalog and add-source, and an in-memory database fills its milestones and posts from here at start. Defaults to the repo's |
| `PIPELINE_RUNNER` | API, pipeline | `local` or `github` |
| `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH` | API | For starting `pipeline.yml` when the runner is `github`, and `deploy-site.yml` when someone publishes (with a real database). Fine-grained token with Actions: write. The branch defaults to `main` |
| `APP_ENV` (or `FLASK_ENV`) | API | `production` turns on the safety checks above |
| `JWT_SECRET` | API | At least 32 random bytes |
| `GOOGLE_CLIENT_ID` | API, admin pages | From Google Cloud |
| `DEV_LOGIN`, `DEV_USERS` | API | Local only: `DEV_USERS="raghav@example.com:Raghav"` seeds the team list in an in-memory database |
| `CORS_ORIGINS` | API | e.g. `http://localhost:3000,https://<user>.github.io` |
| `GIT_SHA`, `PORT` | API | Shown by `/health`, and the port gunicorn listens on in the container |
| `NEXT_PUBLIC_API_URL` | admin pages | e.g. `http://localhost:5050`. `next dev` falls back to that; a production build needs it set (the deploy sets it from the `API_URL` variable), or admin says it isn't connected |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | admin pages | Only needed if the API doesn't send `google_client_id` from `/health` |
| `DATA_DIR` | site build | The folder the site is built from. Defaults to `content/`; the deploy uses `.site-data/` |
| `API_URL` | `deploy-site.yml` | A repository variable (not a secret): the API's address, for the export step and the admin pages. Without it the site is built from `content/` alone and admin can't sign anyone in |

## Milestones and blog posts

Milestones and posts start in `content/milestones.json` and `content/posts/`. Once they're imported into the database, the team edits them in admin, and the files become the seed and the offline copy:

```
cd backend
flask --app sf_api content import-milestones ../content/milestones.json   # each one published, version 1
flask --app sf_api content import-posts ../content/posts                  # sample-*.md is skipped
flask --app sf_api content export-milestones --out ../content             # refresh the file from the database
```

Both imports check the whole file first and save nothing if any record is invalid. A record already in the database is kept unless you add `--replace`, which saves the file's version as a new version (the old one stays in the revisions). An in-memory database runs both imports itself at every start. Sample milestones keep their `sample` flag; the public site never shows them.

Every save in the milestone editor checks the milestone with the shared `Milestone` model (the same rules as the file, em dashes included), then checks it against the rest: every `depends_on` exists, there's no dependency cycle, and every source id (on the milestone, its forecasts and its claims) is in the source catalog. A published milestone can only depend on published ones, and a milestone that published ones depend on can't be unpublished, so the public set is always complete. Each save names the version it started from and is refused with a 409 if someone saved in between, and every save adds a full copy to `milestone_revisions`. Posts work the same way, with the frontmatter rules from `PostFrontmatter`, a body that isn't empty and no em dashes. `milestone_revisions`, `post_revisions` and `site_publishes` are insert-only, like reviews (`backend/tests/test_insert_only.py` checks).

Once milestones are in the database, the triage prompt lists the published, non-sample ones from there. Until then, or when the pipeline's database user can't read `milestones`, it uses `content/milestones.json`.

## Publishing the site

The public site is a static export, so nothing changes on it until it's built again. A build reads a data folder with the same layout as `content/`, made by:

```
python -m sf_shared.export_site --content content --api <the API> --out .site-data
```

It copies `technologies.json` (technology pages stay in git), adds the approved sources from `GET /public/sources` to `content/sources.json` (skipping any that repeat a source already there, by DOI, arXiv id or title), takes the milestones from `GET /public/milestones` once `collection_live` is true, and adds the published posts from `GET /public/posts` to `content/posts/` (the database's version wins a slug clash, with a warning). Then it runs the content validator on the folder. If the API can't be reached after 3 tries, or anything doesn't validate, it exits with status 1 and nothing is deployed, so the site stays as it was. Without `--api` it only copies `content/`.

On GitHub, `deploy-site.yml` runs the export before every build, with the repository variable `API_URL`, and builds with `DATA_DIR=.site-data`. It runs on every push to `main`, every night, and when someone presses "Publish to site" on the admin dashboard: `POST /site/publish` asks GitHub to run the workflow (the same token as "Run now", which needs Actions: write). The deploy takes a few minutes; its log is in the repo's Actions tab.

Locally (an in-memory database, or no `GITHUB_TOKEN`), "Publish to site" sends nothing. The dashboard shows the command to run from `frontend/` instead, which exports from your local API and starts the site on that folder:

```
../.venv/bin/python -m sf_shared.export_site --content ../content --api http://localhost:5050 --out ../.site-data && DATA_DIR=../.site-data npm run dev
```

Stop the dev server that's reading `content/` first. Each press records a `site_publishes` document either way, and `GET /site/publish` counts the approvals and saves since the last one, which the dashboard shows as what's waiting to go out.

## Why it's built this way

- **Every AI step is reviewable.** The AI only sorts. It never publishes, never edits the timeline, and its output is stored untouched next to the human decision.
- **A bad record never breaks the site.** Each public route leaves out a record that doesn't validate and says why, and the publish step checks the whole folder before anything is deployed.
- **Recall over precision.** Missing a relevant paper is worse than reviewing an extra one, so "unsure" goes to a person, a small sample of rejects gets checked too, and anyone can rescue a paper from the Triaged out tab.
- **Small and maintainable.** Plain Python, the Anthropic SDK, Pydantic, httpx and tenacity. No agent frameworks.
