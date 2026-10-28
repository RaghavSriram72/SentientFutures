# Sentient Futures

A public research site on whether whole brain emulation, brain computer interfaces or neuromorphic AI could help with AI alignment or the Intelligence Curse. Its centerpiece is an honest timeline: every forecast is shown as stated, disagreement is flagged instead of averaged away, and every sentence says where it came from (a source, the team, an AI suggestion a person checked, or genuine uncertainty). It's a Sentient Futures incubator project and currently a draft prototype.

## Repo layout

```
content/     Seed data: technology pages, the Notion sources, milestones, blog posts.
             Fill-in guide: content/README.md
shared/      Python shared by everything: enums, Pydantic models, the content
             validator, the publish step (export_site.py), tests
backend/     The admin API (Flask): sign-in, the review queue, pipeline runs, the
             milestone and post editors, add-source, publishing. Deployed to
             DigitalOcean (.do/app.yaml)
pipeline/    The source pipeline: collects papers from arXiv and Semantic Scholar
             and triages them with Claude for a person to review
frontend/    Next.js static site (App Router, static export), deployed to GitHub
             Pages. The admin pages are under /admin/
docs/        How the pipeline, the admin API and publishing work
             (docs/pipeline-architecture.md)
.github/     CI (ci.yml), the Pages deploy (deploy-site.yml) and the weekly
             pipeline run (pipeline.yml)
```

## Where content lives

The public site is static. It's built from a data folder with the same layout as `content/`, so `frontend/lib/data.ts` reads either one.

- Technology pages are edited in git (`content/technologies.json`).
- Sources: the team's Notion sources are in `content/sources.json`. Papers the pipeline finds, and papers someone adds with "Add a source" in admin, are reviewed in admin, and approved ones are added at each publish.
- Milestones and blog posts are edited in admin once they've been imported into the database (`flask --app sf_api content import-milestones` and `import-posts`). After that, `content/milestones.json` and `content/posts/` are the starting data and the offline copy that CI and local builds use.

Publishing runs `python -m sf_shared.export_site`. It writes `.site-data/` from `content/` plus the API's public routes (approved sources, published milestones, published posts) and checks it with the same validator as `content/`. On GitHub, `deploy-site.yml` does this before every build, using the repo variable `API_URL`, and "Publish to site" on the admin dashboard starts that workflow. Locally, the dashboard shows the command to run instead. `docs/pipeline-architecture.md` has the details.

## Local setup

You need Python 3.12 and Node 24.

```
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e "shared[dev]" -e pipeline -e backend

cd frontend
npm install
npm run dev
```

Then open http://localhost:3000. That serves the public site from `content/`. For the admin pages you also need the API: see "Trying the whole thing locally" in `docs/pipeline-architecture.md`.

## Validating content and running the tests

From the repo root, with the venv active:

```
python -m sf_shared.validate content/
python -m pytest -q shared pipeline/tests backend/tests
```

The validator prints `OK: ...` with counts, or every problem with its exact path. If you change `shared/sf_shared/enums.py`, run `python -m sf_shared.export_schema` to regenerate `shared/schema/enums.json` (CI fails if it's out of date).

## Building like GitHub Pages

Pages serves the site under `/SentientFutures/`, so build and preview with that base path. A plain server at `/` would hide base path bugs.

```
cd frontend
NEXT_PUBLIC_BASE_PATH=/SentientFutures npm run build && npm run preview:pages
```

Then open http://localhost:4173/SentientFutures/. Add `DATA_DIR=../.site-data` to build from an exported data folder instead of `content/`. To try the admin pages in this build, also add `NEXT_PUBLIC_API_URL=http://localhost:5050`: a production build without it says admin isn't connected to a server, instead of guessing.

## Deploying

1. Create a public GitHub repo named `SentientFutures`. The name matters: it's the base path.
2. Push `main`.
3. In the repo, set Settings > Pages > Source to "GitHub Actions".
4. Once the API is deployed, set the repository variable `API_URL` (Settings > Secrets and variables > Actions > Variables) to its address, so each deploy includes what the team approved and published in admin.

After that, `.github/workflows/deploy-site.yml` validates `content/`, exports the data folder, builds and deploys on every push to `main`, every night, when someone presses "Publish to site" in admin, and when you press "Run workflow" in the Actions tab. The site lives at `https://<user>.github.io/SentientFutures/`.

The API's own deploy is described at the top of `.do/app.yaml`, and the database and Claude setup in `docs/pipeline-architecture.md`.
