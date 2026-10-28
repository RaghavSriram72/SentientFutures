# Source pipeline

The pipeline finds new papers for the site and gets them ready for a person to review. It doesn't crawl the web: it asks arXiv and Semantic Scholar, which both have search APIs, for papers that match the team's searches. The full design, including the admin API, is in [docs/pipeline-architecture.md](../docs/pipeline-architecture.md).

## What a run does

A run has two stages, and each one moves a paper a single step.

1. Collect. Every enabled search in the search config runs on arXiv and Semantic Scholar, for papers from the last `lookback_days`. Papers the database already has, or that the site already cites in `content/sources.json`, are skipped. Matching is by DOI, arXiv id, Semantic Scholar id, and then title plus year. A title match alone doesn't drop the paper; it's added with the flag `possible_duplicate`. New papers are saved as candidates with status `new`.
2. Triage. Each new candidate gets one Claude call on its title and abstract, and every call is saved in `ai_assessments`. Relevant and unsure papers go to `pending_review`. Papers the model rejects go to `triaged_out` and lose their abstract (journal abstracts are copyrighted), with two exceptions that go to `pending_review` instead: a 3% sample flagged `spot_check`, and any paper whose quote for the rejection isn't in its title or abstract, flagged `quote_mismatch`. A refusal also goes to `pending_review`, flagged `ai_failed`. So does an answer that's cut off or doesn't validate after one retry, and a paper whose request fails on its own (a 400, a timeout after the SDK's retries, or a reply that breaks off). Three failed requests in a row stop triage for the run.

The model only sorts. People approve or reject everything in the review queue, and the pipeline never publishes anything.

## Setup

From the repo root, in the virtual environment:

```
pip install -e ./shared -e ./pipeline
```

The pipeline depends on `sf-shared` (the schema in `shared/`), which isn't on PyPI, so it has to be installed alongside it.

## Running it

```
python -m sf_pipeline.run                        # collect, then triage
python -m sf_pipeline.run --stage collect        # only collect
python -m sf_pipeline.run --stage triage         # only triage what's waiting
python -m sf_pipeline.run --limit 20 --dry-run   # fetch and count, but save no papers and call no model
```

`--limit N` caps both stages: at most N papers per search and collector, and at most N triaged. The search config's own limits (`max_items_per_run`, `max_cost_usd_per_run`) always apply too.

It reads these environment variables:

| Variable | What it's for |
|---|---|
| `MONGO_URI` | The database. When it isn't set, the run uses an in-memory database that's gone when the command ends. |
| `ANTHROPIC_API_KEY` | Triage. Without it, papers are still collected, triage is skipped, and the run log says so. |
| `SEMANTIC_SCHOLAR_API_KEY` | Optional. Raises the Semantic Scholar rate limit. |
| `PIPELINE_CONTACT` | An email address for the User-Agent header, so arXiv and Semantic Scholar can reach us. Set it before running against the live APIs. |
| `PIPELINE_RUNNER` | `local` or `github`. Recorded on the run. |
| `CONTENT_DIR` | Where `content/` is. Defaults to the one in this repo. |

Only one run happens at a time. A second one exits with code 3, and a run that goes 10 minutes without a heartbeat counts as crashed so the next one can start. The command exits with 1 when the run failed and 0 otherwise (including partial runs, where one collector failed but the rest worked).

The API starts runs with the same function the command uses:

```python
from sf_pipeline.run import RunAlreadyRunning, run_pipeline

run_id = run_pipeline(db, stages=["collect", "triage"], limit=None, dry_run=False,
                      trigger="admin", runner="local", requested_by="someone@example.com")
```

It returns the run id and records everything on that run's `pipeline_runs` document. Pass `run_id` to fill in a document the API created already as `queued`.

On GitHub, `.github/workflows/pipeline.yml` runs the same command every Monday, and whenever the admin dashboard or the Actions tab starts it.

## The triage prompt

The instructions the model gets are in [`sf_pipeline/prompts/triage_v1.md`](sf_pipeline/prompts/triage_v1.md), written to be read and edited by the team. The milestones it lists come from the database once they've been imported (the published, non-sample ones), and from `content/milestones.json` until then. The `prompt_version` saved on each assessment is a hash of exactly what the model is sent, so editing the prompt or the milestones gives a new version, and results from before and after the change stay apart. The team notes at the top of the file aren't sent, so editing only those keeps the version. Before relying on an edit, run the gold-set eval described in [`eval/README.md`](eval/README.md).

## The database user

In production, give the pipeline its own database user that can reach only the collections it uses. It never reads `reviews` or `users` and never deletes anything, and it only creates indexes on its own collections, so this role is enough:

| Collection | Actions |
|---|---|
| `sources` | find, insert, update, listIndexes, createIndex, createCollection |
| `ai_assessments` | find, insert, listIndexes, createIndex, createCollection |
| `pipeline_runs` | find, insert, update, listIndexes, createIndex, createCollection |
| `search_config` | find, insert, update, createCollection |
| `milestones` | find |

The pipeline only reads `milestones`, to list the published milestones in the triage prompt. Without that privilege it falls back to `content/milestones.json`, which goes stale once the team edits milestones in admin.

`ai_assessments` has no update or remove, so the database keeps those records insert-only even if a bug tried otherwise. `createIndex` and `createCollection` only matter on a database that doesn't have the collections and indexes yet. The API creates them when it starts, and after that the pipeline only lists the indexes.

In Atlas, add a custom role with these actions under Database Access, create a user with only that role, and put its connection string in the `MONGO_URI` secret of `.github/workflows/pipeline.yml`. On a self-hosted MongoDB the same role is:

```js
db.getSiblingDB("admin").createRole({
  role: "sentientFuturesPipeline",
  privileges: [
    { resource: { db: "sentient_futures", collection: "sources" }, actions: ["find", "insert", "update", "listIndexes", "createIndex", "createCollection"] },
    { resource: { db: "sentient_futures", collection: "ai_assessments" }, actions: ["find", "insert", "listIndexes", "createIndex", "createCollection"] },
    { resource: { db: "sentient_futures", collection: "pipeline_runs" }, actions: ["find", "insert", "update", "listIndexes", "createIndex", "createCollection"] },
    { resource: { db: "sentient_futures", collection: "search_config" }, actions: ["find", "insert", "update", "createCollection"] },
    { resource: { db: "sentient_futures", collection: "milestones" }, actions: ["find"] },
  ],
  roles: [],
})
```

The API's user follows the same rule for the records the audit trail depends on: find and insert on `reviews`, find on `ai_assessments`, and no update or remove on either. `pipeline/tests/test_pipeline_insert_only.py` and `backend/tests/test_insert_only.py` check that the code never tries.

## Tests

```
python -m pytest -q pipeline/tests
```

They run offline. HTTP goes through `httpx.MockTransport` with saved responses, and the model is a fake client that returns canned answers.

## Layout

| File | What's in it |
|---|---|
| `sf_pipeline/run.py` | `run_pipeline`, the search config, and the command line |
| `sf_pipeline/runs.py` | The run document: one run at a time, heartbeats, the log |
| `sf_pipeline/collect.py` | The collect stage |
| `sf_pipeline/collectors/` | arXiv and Semantic Scholar, the shared HTTP retry and rate limiting, and the search syntax translation |
| `sf_pipeline/dedupe.py` | Matching new papers against what we already have |
| `sf_pipeline/triage.py` | The prompt, the Claude call, checking the answer, routing, and the triage stage |
| `sf_pipeline/pricing.py` | What each model costs per token |
| `sf_pipeline/eval.py` | The gold-set eval |
| `eval/` | The gold set and how to fill it in |
