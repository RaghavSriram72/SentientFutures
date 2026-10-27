# Sentient Futures

A public research site on whether whole brain emulation, brain computer interfaces or neuromorphic AI could help with AI alignment or the Intelligence Curse. Its centerpiece is an honest timeline: every forecast is shown as stated, disagreement is flagged instead of averaged away, and every sentence says where it came from (a source, the team, an AI suggestion a person checked, or genuine uncertainty). It's a Sentient Futures incubator project and currently a draft prototype.

## Repo layout

```
content/     The site's data: milestones, sources, technology pages, blog posts.
             Fill-in guide: content/README.md
shared/      Python schema shared by everything: enums, Pydantic models, the content validator, tests
frontend/    Next.js static site (App Router, static export), deployed to GitHub Pages
.github/     CI (ci.yml) and the Pages deploy (deploy-site.yml)
```

The backend (Flask) and the source pipeline come in later phases.

## Local setup

You need Python 3.12 and Node 24.

```
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e "shared[dev]"

cd frontend
npm install
npm run dev
```

Then open http://localhost:3000.

## Validating content

From the repo root, with the venv active:

```
python -m sf_shared.validate content/
pytest shared
```

The validator prints `OK: ...` with counts, or every problem with its exact path. If you change `shared/sf_shared/enums.py`, run `python -m sf_shared.export_schema` to regenerate `shared/schema/enums.json` (CI fails if it's out of date).

## Building like GitHub Pages

Pages serves the site under `/SentientFutures/`, so build and preview with that base path. A plain server at `/` would hide base path bugs.

```
cd frontend
NEXT_PUBLIC_BASE_PATH=/SentientFutures npm run build && npm run preview:pages
```

Then open http://localhost:4173/SentientFutures/.

## Deploying

1. Create a public GitHub repo named `SentientFutures`. The name matters: it's the base path.
2. Push `main`.
3. In the repo, set Settings > Pages > Source to "GitHub Actions".

After that, `.github/workflows/deploy-site.yml` validates `content/`, builds and deploys on every push to `main`, every night, and whenever you press "Run workflow" in the Actions tab. The site lives at `https://<user>.github.io/SentientFutures/`.
