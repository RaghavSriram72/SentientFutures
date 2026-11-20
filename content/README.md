# Filling in the content

The public site is built from the files in this folder plus what the team approves and publishes in admin. "Where each thing is edited" below says which is which. When something changes, the site shows it the next time it's built: every night, on every push to `main`, and whenever someone presses "Publish to site" on the admin dashboard.

You don't need to know how to program to edit these files, but you do need to be careful, because the format is strict. It's strict so that a checker (the validator) can read every file and tell you exactly what's wrong and where. This guide covers importing sources from Notion, adding a source, a milestone and a forecast, how the technology pages are laid out, and how to run the checker and read its messages.

## What's in here

| File | What it holds |
|---|---|
| `milestones.json` | The timeline. One entry per milestone, with its forecasts inside it. |
| `sources.json` | Every paper, report, post, talk, podcast or book we cite. Most of them come from the team's Notion database. |
| `technologies.json` | The three technology pages: WBE, BCI and neuromorphic AI. |
| `scorecard.json` | The team's scorecard workbook (v0.4): the evidence register, causal links, risks, governance checklist, milestone assessments, Codebook and more. Written by the workbook import. Never edit it by hand. |
| `posts/` | Blog posts, one Markdown file each. |
| `README.md` | This guide. |

## Where each thing is edited

| What | Where it's edited | What the file here is for |
|---|---|---|
| Technology pages | `technologies.json`, in git. The parts that come from the workbook (the ratings and the workbook sections) are written by the workbook import, so edit them in the workbook and import again. | The real thing. The pages stay in git on purpose: they're long, reviewed line by line, and a pull request is the right place to discuss a change to a verdict. |
| The workbook | The team's spreadsheet ("Neuroengineering scorecard", by Vilija), then `python -m sf_shared.import_workbook` | `scorecard.json` is the import's output. See "The workbook import" below. |
| Sources | `sources.json`, in git, for the ones imported from Notion. Papers found by the pipeline or added with "Add a source" in admin are reviewed and approved in admin. | The real thing for the Notion sources. Approved papers are added to them at each publish. |
| Milestones | In admin (`/admin/milestones/`), once they've been imported into the database | Before the import, the real thing. After it, the starting data and the offline copy that CI and local builds use. |
| Blog posts | In admin (`/admin/posts/`), once they've been imported | The same as milestones. Files named `sample-*.md` are examples for this guide and are never imported. |

The import is a one-time step for whoever runs the database (in `backend/`, with `MONGO_URI` set to the real database):

```
flask --app sf_api content import-milestones ../content/milestones.json
flask --app sf_api content import-posts ../content/posts
```

After that, edit milestones and posts in admin, not here: an edit to these files no longer reaches the site. To bring the files up to date with the database (so CI and local builds show the same thing), run `flask --app sf_api content export-milestones --out ../content` and commit the result.

Publishing builds a data folder (`.site-data/`) from this folder plus the approved sources, published milestones and published posts in the database, checks it with the same validator, and builds the site from it. If the check fails, nothing is published and the site stays as it was. `docs/pipeline-architecture.md` has the details, including how to try it locally.

Entries with `"sample": true` are placeholders. There are two kinds:

- Worked examples: the BCI and neuromorphic milestones, and the seven sources whose ids start with `sample-`. These are made up and their sources are fictional. Most of their text starts with "Sample." (source summaries start with "Placeholder summary."). The public site never shows them: the timeline, the technology pages and the source database all leave them out. They stay in the files as examples of the format, and the sample sources stay only because the sample milestones cite them. A real milestone or page can't cite a sample source or depend on a sample milestone: the validator and the milestone editor both refuse it, since the link would lead nowhere on the public site.
Technology pages don't use `sample`. The BCI and neuromorphic pages have `"unreviewed_ai_sections": true` instead: their intro and outline sections (`claims_to_solve`, `mechanism`, `strongest_case`, `strongest_objections`, `artificial_minds_questions`) were drafted by an AI and nobody on the team has reviewed them yet. Those lines keep the dashed AI outline. Their ratings and workbook sections are the team's, from the workbook.

The WBE page and the eight WBE milestones are real team content. The WBE page has `"unreviewed_ai_sections": false`, and every sentence is marked `team` (a few milestone lines are `unclear` where we haven't looked yet). The sources with ids `s01` to `s30` are real too. They come from the team's Notion database (see "Importing sources from Notion" below), and their summaries are the team's own.

Only a sample, or a page with `unreviewed_ai_sections`, can show AI text that nobody has checked. The validator prints a warning with a count of those lines, and each one needs a `reviewed_by` before the flag comes off. To add something new, copy the entry closest to it and replace every value. Real entries leave `sample` out or set it to `false`. We'll delete or review the samples once there's enough real content.

## Five JSON rules that prevent most errors

The files are JSON. It's picky, but it only has a few rules:

1. Text goes in straight double quotes: `"like this"`. Word and Google Docs turn quotes into curly ones (“ ”), which JSON doesn't accept, so paste into a plain text editor, not a word processor.
2. Numbers, `true`, `false` and `null` go without quotes: `2045`, not `"2045"`. `null` means "nothing here" and is different from `"null"` or `""`.
3. Commas go between items, never after the last one. `["a", "b"]` is fine. `["a", "b",]` breaks the file.
4. Field names (the part before the colon) must match the existing entries exactly: lowercase, with underscores. `would_move_earlier`, not `wouldMoveEarlier` or `would move earlier`.
5. A double quote inside text needs a backslash in front of it: `"text": "She called it \"a long shot\"."`

A good editor helps a lot. VS Code (free) underlines broken JSON in red as you type, and GitHub's web editor works too.

## Provenance: where each sentence comes from

Every sentence on the site carries a label saying where it came from, and the site styles each kind differently so readers can tell them apart. In the files, each piece of text that appears on the site is written as a small block called a **claim**:

```json
{
  "text": "The sentence the reader sees.",
  "provenance": "team"
}
```

There are four kinds of provenance:

| Provenance | Means | What it needs | Shown on the site as |
|---|---|---|---|
| `source` | Taken straight from a cited source. | `source_ids` (at least one) and the exact `quote` (300 characters or less). Add `quote_location` if you can. | A footnote marker and the quote |
| `team` | Our own reading or interpretation. | Nothing extra. You can still list the `source_ids` it's based on. | An "Our read" tag |
| `ai` | Suggested by an AI model. | `reviewed_by`: the name of the person who checked it. Only sample entries may leave it out. | An "AI-suggested · checked by ..." label, or "AI-suggested · not yet reviewed" on a sample |
| `unclear` | Genuinely uncertain. | `unclear_reason`, plus `unclear_note` when the reason is `other` (and only then). | Hatching and "Unclear · reason" |

Examples of each:

```json
{
  "text": "The implant kept working for a year in every participant.",
  "provenance": "source",
  "source_ids": ["smith-2025-implant-trial"],
  "quote": "All five devices remained functional at the 12-month follow-up.",
  "quote_location": "p. 4"
}
```

```json
{
  "text": "Regulators will probably want several years of safety data first.",
  "provenance": "team"
}
```

```json
{
  "text": "Signal quality through the skull is the main limit.",
  "provenance": "ai",
  "reviewed_by": "Vilija"
}
```

```json
{
  "text": "We don't know yet whether the bottleneck is scanning, modeling or compute.",
  "provenance": "unclear",
  "unclear_reason": "conflicting_evidence"
}
```

The reasons for `unclear` are:

| `unclear_reason` | Use it when |
|---|---|
| `no_relevant_evidence` | You looked and found nothing that bears on it. |
| `conflicting_evidence` | Credible sources point in different directions. |
| `underspecified_proposal` | The proposal isn't specific enough to assess. |
| `search_incomplete` | We haven't finished looking. |
| `indirect_evidence_only` | Only indirect evidence bears on it (one of the workbook's Codebook reasons). |
| `outcome_not_operationalized` | The outcome isn't defined well enough to test (a Codebook reason). |
| `information_inaccessible` | The information exists but we can't get at it (a Codebook reason). |
| `other` | None of these fit. Explain in `unclear_note`. Only claims can use `other`. Source credibility, scorecard rows and assessments have no note field, so they need one of the other reasons. |

### Use `source` only when you can paste the exact words

Marking a claim `source` tells the reader that the source says this, in these words. If you can't paste the exact words, use `team` for our reading of the evidence, or `unclear` if we don't know. Never paraphrase into the `quote` field, and never mark something `source` because you remember a paper saying something like it.

Keep quotes short (300 characters at most), and quote the smallest passage that supports the sentence.

## Importing sources from Notion

The team finds and screens sources in its Notion database ("Scouting the Field"). A script copies that database into `sources.json`. Each row becomes a source whose id is its register id in lowercase, so S02 becomes `s02`.

1. In Notion, open the database, click the ••• menu at the top right, then Export. Choose "Markdown & CSV", turn off "Include subpages", and export.
2. Unzip the download. You only need the `.csv` file inside it.
3. In a terminal in the top folder of the repo, with the virtual environment active (see "Checking your work"), do a dry run:

   ```
   python -m sf_shared.import_notion path/to/export.csv --dry-run
   ```

   It prints every source it would add or update, plus a `note:` line for anything to check by hand, and writes nothing.
4. If the list looks right, run the same command without `--dry-run`.
5. Run the validator.

Notion owns some fields, and every import overwrites them from the export: the title, `url` and `other_urls`, the year, `source_type`, `technology` (from the Mechanism column), `problem` (from Category), `claim_directions` and `added_by`. To change one of these, change it in Notion and import again, or the next import will undo your edit.

Everything else belongs to this file. The import fills in authors, summary, venue, DOI and arXiv id when it first adds a source, and after that it leaves them alone, so you can correct an author list or edit a summary here and keep the change. Add `--refresh-summaries` to replace the summaries with Notion's text as well. That replaces every summary edited here, so look at what changed before you commit. Authors are never refreshed.

Some rows are left out. A row whose Resource Type says "screening pending" is skipped until the team finishes screening it, and a row with no link is skipped too. Sample sources are never touched. If a source is on the site but missing from the export, it stays, and the import tells you which one.

The import never fills in `kind` or the five rubric ratings, because the Notion database doesn't have them. New sources arrive with all six set to `null`, which the site shows as not rated yet. When an author field holds a URL or "?", the source gets an empty author list and a `note:` line, so add the names here by hand.

## Adding a source

Sources in the Notion database come in through the import above. Add a source by hand only if it isn't in Notion. Add it to `sources.json` before anything cites it, because milestones and forecasts point to sources by their id.

1. Open `sources.json` and copy one of the entries, from its `{` to its `}`.
2. Paste it at the end of the list, before the final `]`, and put a comma after the entry above it.
3. Replace every value, using the field guide below.

| Field | What to put |
|---|---|
| `id` | A short, permanent name. Imported sources use their register id in lowercase, like `"s02"`. For anything else, use first author, year and a keyword, like `"sandberg-2008-roadmap"`. Lowercase letters, numbers and hyphens only. Never change it once it's public. |
| `register_id` | The team's register id, like `"S02"`: a capital S and at least two digits. No two sources can share one. The workbook's evidence entries find sources by this id. Leave it out, or use `null`, for a source that isn't in the register. |
| `title` | The full title. |
| `authors` | A list, even for one author: `["Anders Sandberg", "Nick Bostrom"]`. An organization is fine as an author. Use `[]` if the authors aren't known. |
| `year` | The year it was published, as a number. |
| `url` | A link starting with `https://`. Prefer the DOI or arXiv page. |
| `other_urls` | Other links for the same source, each starting with `https://`: a mirror, a write-up, or the primary source behind a secondary one. `[]` if there are none. |
| `doi`, `arxiv_id`, `venue` | Fill in if known, otherwise `null`. The venue is the journal, conference, blog or publisher. |
| `source_type` | `peer_reviewed`, `preprint`, `blog`, `report`, `forum_post`, `talk`, `podcast` or `book`. |
| `kind` | `argument` if it proposes or criticizes neuroengineering as a response to alignment or the Intelligence Curse. `milestone_evidence` if it's technical progress that bears on a milestone. `null` until someone has decided. |
| `technology` | A list of the technologies it's about: any of `wbe`, `bci`, `neuromorphic`, `hybrid`. Use `[]` for general background that isn't about one of them, like the Intelligence Curse essay (`s15`). |
| `problem` | `alignment`, `intelligence_curse`, `both`, or `null` if it's about neither directly. |
| `claim_directions` | Which way the source argues, from Notion's Claim (+/-) column: any of `ai_alignment`, `ai_misalignment`, `human_empowerment` and `human_disempowerment`. A source can argue more than one. `[]` if nobody has recorded it. These values are still drafts. |
| `evidence_type` | `argument`, `simulation`, `experiment`, `deployment` or `review`. |
| `directness` | How close it is to our scenario: `direct`, `adjacent` or `remote`. |
| `independence` | `independent` (no stake), `non_biased` (some connection, no obvious stake) or `affiliated` (the author or funder has a stake). |
| `relevance` | `core`, `supporting`, `peripheral` or `not_relevant`. These values are still drafts. |
| `credibility` | `strong`, `adequate`, `weak` or `unclear`, also drafts. If `unclear`, set `credibility_unclear_reason` to one of the unclear reasons above, except `other` (a source has nowhere to write the note). |
| `summary` | A claim in our own words (usually `team`). Don't paste the abstract: we write our own summary for copyright reasons. |
| `ai_suggested_fields` | A list of the field names an AI filled in, like `["evidence_type"]`, so the site can label them. Use `[]` if a person filled in everything. Allowed: `source_type`, `kind`, `technology`, `problem`, `evidence_type`, `directness`, `independence`, `relevance`, `credibility` and `credibility_unclear_reason`. Don't list `summary`: if an AI wrote it, set the summary's own `provenance` to `ai`. |
| `added_by` | Who added the source to the Notion database, or `null`. The import credits people by the name the site uses, so Notion's "Aila" comes in as "Vilija". |
| `reviewed_by`, `reviewed_on` | Who checked this entry, and when (`"2026-10-27"`). Required whenever `ai_suggested_fields` isn't empty. |
| `quality` | Register sources only, written by the workbook import: the "3a Source Quality" cells word for word, as `source_type`, `empirical_theoretical`, `original_secondary`, `peer_review` and `affiliation`. Leave it out for other sources. |
| `screening_pending` | `true` while the workbook marks the source "screening pending" (written by the import). Leave it out otherwise. |

The five rubric fields (`evidence_type`, `directness`, `independence`, `relevance` and `credibility`) can each be `null`, which means not rated yet. Leave a rating `null` until someone has read the source and decided. If an AI suggests a rating, list the field in `ai_suggested_fields` and have a person check it.

## Adding a milestone

A milestone is one step a technology has to pass, like "a high-bandwidth implant is approved for medical use." Each one is a card on the timeline, placed by its estimated window, or in the "Timing unknown" zone until it has one.

Once the milestones are imported into the database, add and edit them in admin instead (`/admin/milestones/`). The editor saves the same fields described here and runs the same checks when you save. The steps below are for this file before the import, and for the offline copy.

1. Open `milestones.json` and copy the entry closest to what you're adding. Between them, the existing entries cover the main cases:
   - `neuro-sample-alignment-benefit`: a team estimate with no end date, and three forecasts that disagree, one of them "never"
   - `bci-sample-medical-approval`: two forecasts that roughly agree
   - `bci-sample-consumer-text`: a disagreement override
   - `bci-sample-agency`: no estimate and no forecasts yet
   - `neuro-sample-energy`: a milestone that has already happened
   - `wbe-reliability` and the seven WBE milestones after it: real team entries with a status, a bottleneck and a success criterion, but no dates yet
2. Paste it at the end of the list (with a comma after the entry above it) and replace every value.
3. Add any new sources to `sources.json`.
4. Run the validator (see below).

| Field | What to put |
|---|---|
| `id` | Technology plus a short name, like `"bci-medical-approval"`. Lowercase and hyphens. Never change it once it's public, because other milestones and links point to it. |
| `name` | The milestone as a short statement of what happens: "A non-invasive headset decodes text at typing speed." |
| `technology` | `wbe`, `bci`, `neuromorphic` or `hybrid`. |
| `stage` | `possible` (someone has shown it can be done), `widely_available` (cheap, reliable and accessible enough to matter) or `actually_helping` (measurably helping with alignment or human agency). |
| `category` | `technical_capability`, `high_level_fidelity`, `reliability_robustness`, `scalable_production`, `economic_viability`, `equitable_access`, `safety_welfare_assurance`, `legal_regulatory` or `institutional_legitimacy`. The site groups categories into three types (Technical, Deployment, Welfare and governance). The grouping lives in `shared/sf_shared/enums.py` (`MILESTONE_TYPES`), and a milestone's type is never stored. |
| `status` | `not_demonstrated`, `prototype` (shown once, in limited conditions), `replicated` (shown more than once, by more than one group), `mature` (routine), `not_claimed` (none of our current sources claims the proposal will do this, as in the scorecard's "if claimed" rows) or `unclear` (the workbook's "Unclear"). |
| `status_basis` | A claim saying why it has that status. |
| `achieved_in` | The year it happened, or `null` if it hasn't. |
| `achieved_in_basis` | `null`, unless `achieved_in` is set. Then it must be a `source` claim with a quote showing it happened. |
| `confidence` | `high`, `medium` or `low`: how sure we are. Required when `estimate` is set. You can also set it without an estimate (the WBE milestones carry the scorecard's Low); otherwise use `null`. |
| `summary` | A claim: what this milestone is and why it matters. |
| `success_criterion` | A claim: how we'd know it has happened. Be concrete ("40 words per minute, no implant, in a peer-reviewed study"). |
| `main_bottleneck` | A claim: what's holding it back, or `null` when nobody has said (the workbook leaves some empty). |
| `depends_on` | A list of milestone ids that have to happen first, or `[]` if there are none. |
| `source_ids` | A list of every source linked to this milestone, including the ones its forecasts and claims cite. The panel lists these. On the WBE milestones the workbook import writes it (see "The workbook import"), so a hand edit there is replaced by the next import. |
| `estimate` | Our own range, or `null` if the team hasn't agreed on one. See "The team estimate" below. |
| `forecasts` | A list of forecasts from sources (see "Adding a forecast"), or `[]` if there are none yet. |
| `disagreement_override` | Usually `null`. See "Disagreement" below. |
| `disagreement_note` | An optional claim explaining a disagreement in words, or `null`. |
| `would_move_earlier` | A list of claims: evidence that would make this happen sooner. It needs at least one. If we don't know, use one `unclear` claim. |
| `would_move_later` | The same, for evidence that would push it later. |
| `artificial_minds_questions` | A list of claims about the consciousness, moral status, identity or welfare questions this raises. `[]` is fine. |
| `assessment_confidence`, `applies_to`, `criterion_met`, `evidence_entries`, `timing`, `note` | Optional, from the workbook's milestone tab (1a), written by the import on the WBE milestones: the tab's "Confidence" in the status (separate from `confidence`, which goes with the team range), "Applies to", "Criterion met?", the entry ids its evidence cell cites, "Timing (dated sources only)" and "Note". Leave them out on other milestones. |

Two notes on the WBE milestones. The team's scorecard doesn't assign stages yet, so for now reliability, technical capability, and safety and welfare assurance are `possible`, and the other five are `widely_available`. Change them when the team decides. Their sources come from their row in the workbook's tab 1a, through the import: `source_ids` lists every source that row cites (the exact rule is under "The workbook import"), and `status_basis.source_ids` lists the ones under the status (the sources of the entries in `evidence_entries`, plus any S-id written in the "Evidence (entries and basis)" cell). A row that cites no source gives `[]` (WBE M4, M7 and M9 in v0.4, so `wbe-safety-welfare`, `wbe-legal` and `wbe-access`).

### The team estimate

`estimate` is the range the team stands behind. When it's set, the timeline draws it as a solid ribbon, and every forecast stays visible next to it.

```json
"estimate": {
  "earliest": 2035,
  "latest": null,
  "basis": {
    "text": "We start at 2035 because the earliest forecast assumes an agreed alignment benchmark, and there isn't one yet.",
    "provenance": "team"
  },
  "set_by": "Vilija",
  "set_on": "2026-10-27"
}
```

`latest` can be `null`, meaning "not before 2035, and we won't guess an end." Dates are always written `YYYY-MM-DD`. Remember to set `confidence` too.

### Disagreement

The site flags disagreement on its own. Under rule v0.2, two forecasts disagree when their windows are more than 10 years apart, or when one says "never" and the other gives a year. Two forecasts only count as coming from the same forecaster (and are never compared) when both the forecaster name and the source match. A flagged milestone gets a "Sources disagree" badge, and all of its forecasts stay visible side by side.

If the rule gets it wrong, the team can override it, but only with a written reason that's shown on the site:

```json
"disagreement_override": {
  "flagged": false,
  "basis": {
    "text": "These two forecasts are about different things, so we don't count it as disagreement.",
    "provenance": "team"
  }
}
```

Use `"flagged": true` to raise the badge when the rule missed a real disagreement.

## Adding a forecast

A forecast is one prediction from one forecaster in one source, stored exactly as stated. We never average forecasts or turn a range into a single year. Forecasts live inside their milestone's `forecasts` list. Here's one, taken from a sample, so replace every value:

```json
{
  "id": "f1",
  "source_id": "sample-alignment-argument",
  "forecaster": "Example Researcher",
  "claim": "First results between 2030 and 2033",
  "quote": "The exact sentence from the source, copied word for word.",
  "quote_location": null,
  "made_in": 2024,
  "earliest": 2030,
  "latest": 2033,
  "never": false
}
```

| Field | What to put |
|---|---|
| `id` | `f1`, `f2`, `f3` and so on, unique within the milestone. |
| `source_id` | The id of the source it comes from. Add the source to `sources.json` first. |
| `forecaster` | Who made it, in a way that identifies them: a person's name, or a group plus the source, like "Median respondent, Example Survey 2024". Avoid a generic label like "Median survey respondent". The timeline treats two forecasts as coming from the same forecaster only when both this name and the `source_id` match, and readers need the label to tell forecasts apart. |
| `claim` | The forecast in a few words, as shown on the site. |
| `quote` | The exact words from the source. Every forecast needs one, and without a quote there's no forecast. |
| `quote_location` | Page, section, table or timestamp, or `null` if there isn't one. |
| `made_in` | The year the forecast was made (usually the publication year), not the year it predicts. |
| `earliest`, `latest`, `never` | The shape of the forecast. See the table below. |

The shapes:

| The source says | `earliest` | `latest` | `never` |
|---|---|---|---|
| "in 2045" (a point) | `2045` | `2045` | `false` |
| "between 2045 and 2060" (a range) | `2045` | `2060` | `false` |
| "by 2045" | `null` | `2045` | `false` |
| "not before 2045" | `2045` | `null` | `false` |
| "never" | `null` | `null` | `true` |

`earliest` can't be later than `latest`, and a forecast with `never: false` needs at least one year. Years after 2100 are fine: the timeline runs to 2100 and draws later years at its end, and the panel shows the real year.

If a source gives a probability ("50% by 2050"), write the year it gives and put the probability in `claim`: `"50% chance by 2050"`.

## Writing a blog post

Once the posts are imported into the database, write them in admin (`/admin/posts/`): a post saved as a draft stays off the site, and one marked published goes out at the next publish. The editor checks the same rules as below. A post's slug is its web address, so it can't change once the post has been published.

Before the import, and for the offline copy, each post is a Markdown file in `posts/`, with a short header (called frontmatter) between two `---` lines:

```markdown
---
title: "About this blog"
slug: about-this-blog
date: "2026-10-27"
author: Vilija
summary: "One sentence that shows on the blog index."
---

The post itself starts here, in plain Markdown.
```

Put the date in quotes. When in doubt, put the other values in double quotes too. The header is read as YAML, which misreads values that contain a colon, start with `#`, `-`, `?` or a quote mark, or look like a number, a date, `yes`/`no` or `null`. The validator reads the header the same way the site does and tells you which value to quote. The `slug` becomes the end of the post's web address, so keep it lowercase with hyphens, and make it unique. The site needs at least one post to build.

## The technology pages

`technologies.json` has one entry each for `wbe`, `bci` and `neuromorphic`. Every page needs an `id`, `name`, `short_name`, `headline`, `intro` and `scorecard`. All the other sections are optional, so a page can start as an outline and fill in as the review goes. Every piece of text is a claim, with the same provenance rules as above.

The `headline` needs exactly one word or phrase in asterisks, which the site shows in italics: `"Could an *emulated* human brain improve alignment or preserve human agency?"`. Write a plain headline that says what the page is about, then put the asterisks on a word that reads naturally in italics.

### Outline sections

The site writes these five lists of claims itself: `claims_to_solve`, `mechanism`, `strongest_case`, `strongest_objections` and `artificial_minds_questions`. On the BCI and neuromorphic pages an AI drafted them (see `unreviewed_ai_sections` above). The WBE page leaves them as `[]`. `alternatives` and `tension` are the team's own text too.

### Workbook sections

These come from the team's scorecard workbook (v0.4) and are written by the workbook import, word for word. Don't edit them here: change the workbook and import again. Codes in the text (E037, S13, WBE-O-L1, R01) stay as written, and the site links them.

| Field | Workbook tab | What it holds |
|---|---|---|
| `scope` | 1 Scope | Claims for `intervention` (the family definition), `deployment_scenario`, `affected_groups`, `time_horizon`, `comparator` and `problems_claimed`; `problem` (`alignment`, `intelligence_curse` or `both`, from the arrow at the end of the problems cell); then from "Source IDs / basis" both `source_ids` (ranges expanded, for links and counts) and `source_ids_text` (the cell word for word, which the page shows). |
| `alignment_assessment` | 4 Alignment Judgment | The family row: `problem_addressed`, `mechanism`, `rating`, `confidence`, `reason` ("Main gap, or reason for rating") and `decisive_question`, plus `scenarios`, one per scenario row: `scenario`, `problem`, `mechanism`, `supporting` and `contrary_or_qualifying` (entry ids) and `gap`. |
| `intelligence_curse_assessment` | 5 Intelligence Curse Judgment and 6 Agency and Ownership | `mechanism`, four `questions` (each question is the tab's column header), `rating`, `confidence` and `reason`; `decisive_question` is null (the tab has none). `agency` holds the tab 6 rows (`group`, `effect`, `mechanism`, `ownership_questions`, `entries`) and `ownership_gate` the "Ownership gate" row. |
| `artificial_minds_by_stage` | 4.1 Artificial Minds | One entry per row of the tab for the family, empty rows too: `stage` ("S3", or null for "All stages"), `stage_label` (the Stage cell word for word), `stage_number`, then `consciousness`, `moral_status`, `identity`, `welfare` and `protections` (each the cell, or null), `source_ids` and `entries`. |
| `welfare_governance` | 9 Welfare and Governance Judgment | Claims for `exposed` ("Who is exposed"), `harms` ("Main harms (risk IDs)") and `rationale`. Severity, likelihood and confidence for each domain are on the scorecard's risk rows. |

The assessments' `rating`, `confidence` and `unclear_reason` repeat those of the case row with the same `problem`, and the validator checks that they match.

### The scorecard summary

`scorecard` holds the six headline judgments. Every page has the same six rows, in this order:

| `id` | `dimension` | `scale` | `problem` |
|---|---|---|---|
| `alignment-case` | Alignment case | `case` | `alignment` |
| `intelligence-curse-case` | Intelligence Curse case | `case` | `intelligence_curse` |
| `human-welfare-risk` | Human welfare risk | `risk` | `null` |
| `artificial-mind-welfare-and-rights-risk` | Artificial-mind welfare and rights risk | `risk` | `null` |
| `governance-risk` | Governance risk | `risk` | `null` |
| `safeguard-adequacy` | Safeguard adequacy | `case` | `null` |

Every page has the same rows, with the same id, dimension, scale and problem, in the same order. The validator checks this. The id never changes once it's public, because the compare page's address and the link to each rating use it. To rename a dimension, change `dimension` on all three pages and keep the id.

An id can't be `artificial-minds` or a milestone category written with hyphens, like `economic-viability`, because the compare page uses those for its own views.

Human welfare risk is about harm to people: mental privacy, autonomy and manipulation, workplace surveillance and neuromanipulation, and dependency and deskilling. Harm to the artificial minds themselves has its own row.

The import writes each row's `rating`, `confidence`, `unclear_reason`, `severity`, `likelihood`, `applicable` and `basis`. The rules:

- A `case` row has a `rating` (`strong`, `moderate`, `weak`, `unclear` or `not_claimed`), a `confidence` and a `basis` claim (the workbook's reason for the rating).
- A `risk` row has no rating: `"rating": null`. The workbook keeps a risk's severity, likelihood and confidence apart and never combines them. It has `severity` (`very_high`, `high`, `medium`, `low` or `unclear`), `likelihood` (`high`, `medium`, `low` or `not_assessable`) and `confidence`. Before the first import both may be null. When the workbook says the risk doesn't apply ("Not applicable", as for BCI and artificial minds), `applicable` is `false` and severity and likelihood stay null. A risk row's `basis` is optional and usually null.
- `unclear_reason` is optional (the workbook gives none), and it can't be `other`, because a row has nowhere to write the note. A risk row never has one.
- `not_claimed` means the proposal doesn't claim that outcome, which is different from `weak` or `unclear`. Don't also list that outcome under `claims_to_solve`.
- `potential_severity` and the rule that a Low risk needs a sourced basis are gone, along with the single risk rating.

### Rating cards

Each scorecard row is shown on its page as a rating card. The evidence on a card comes from the workbook's register (`scorecard.json` entries whose "Ratings it feeds" names the rating). A row can also carry a `tracker` with what the card adds to the rating. Every field is optional. When the evidence, what would change the assessment or the milestones are missing, the card lists them in a "Not added yet" line. "Last updated" is shown only once `last_updated` is set, and an empty history reads "No changes recorded yet."

| Field | What to put |
|---|---|
| `what_would_change` | A claim: the evidence that would change the assessment. |
| `last_updated` | The date the team last reviewed this rating, like `"2026-11-16"`. Required once there's a history. |
| `history` | The changes to the rating, oldest first. See "Recording a change" below. |
| `milestone_ids` | The ids of the milestones this rating informs, in the order the card should list them. Only milestones of this page's technology, and never a sample. Leave it out until the team has decided. |
| `placeholder` | `true` while the tracker is an example the team hasn't checked. Leave it out otherwise. |

Milestone links are checked against `milestones.json`. Before you link a milestone that was made in admin, run `flask --app sf_api content export-milestones --out ../content` (in `backend/`) and commit the result, so the file has it. When the site is published, a link to a milestone that isn't published is left out, and the publish log names it.

`placeholder` is different from `sample`. A sample is a made-up record that the public site leaves out. A placeholder tracker is shown: the card puts the tracker's fields in one box labelled "Placeholder". The rating, confidence and basis stay outside the box. The validator prints a warning on every run while the flag is on. Right now the only placeholder is the WBE Alignment case row.

To make a placeholder real, confirm or edit its fields, delete `"placeholder": true`, and from then on record changes in `history`. A placeholder can't have a history, and neither can a risk row, which has no rating to change.

#### Recording a change

When a rating or its confidence changes, update `rating` or `confidence` on the row, add an entry at the end of `history`, and set `last_updated`. The card's history keeps the old values visible. This example is made up, so don't copy its text:

```json
"tracker": {
  "last_updated": "2026-11-16",
  "history": [
    {
      "date": "2026-11-16",
      "rating_before": "unclear",
      "rating_after": "unclear",
      "confidence_before": "low",
      "confidence_after": "medium",
      "note": {
        "text": "Confidence increased from Low to Medium after new evidence on high-level emulation fidelity. Alignment rating unchanged.",
        "provenance": "team",
        "source_ids": ["lee-2026-emulation-fidelity"]
      }
    }
  ]
}
```

The rules:

- Entries go oldest first, and new ones go at the end.
- Each entry starts where the one before it ended: its `rating_before` is the previous entry's `rating_after`, and the same for confidence.
- The newest entry ends at the row's current `rating` and `confidence`.
- The ratings are case ratings, like `rating`.
- `last_updated` can't be before the newest entry, and no date can be more than a day in the future.
- An entry where neither value changed is fine. It records a review that left the rating as it was, and the card shows "Rating unchanged" and "Confidence unchanged".
- The `note` says what changed and why. Its `source_ids` names the source or sources that caused the change, and each one must be in `content/sources.json`. The note can't be `unclear`, and an `ai` note needs `reviewed_by` like any other AI claim.

## The workbook import

The team's research lives in a spreadsheet, "Neuroengineering scorecard" (written by Vilija). The import copies it into this folder, word for word. Every new version of the workbook reaches the site this way. The spreadsheet itself is never committed (`.gitignore` leaves it out).

With the virtual environment active (see "Checking your work"), do a dry run first. It prints what would change, as a diff, and writes nothing:

```
python -m sf_shared.import_workbook "path/to/Neuroengineering scorecard v0.4.xlsx" --version 0.4 --dry-run
```

If the changes look right, run it again without `--dry-run`. `--version` is the workbook's version (no cell states it); without it, the import reads it from a file name like "... v0.4.xlsx" and stops if it can't. Running the import twice gives the same files.

The import writes these parts and nothing else:

- `scorecard.json`: the whole file.
- `technologies.json`: on each page, the scorecard rows' `rating`, `confidence`, `unclear_reason`, `severity`, `likelihood`, `applicable` and `basis`, and the workbook sections (`scope`, `alignment_assessment`, `intelligence_curse_assessment`, `artificial_minds_by_stage`, `welfare_governance`). The site's own text (`name`, `headline`, `intro`, the outline sections, `alternatives`, `tension`) is never touched.
- `sources.json`: register sources the site doesn't have yet (S17 in v0.4), and on each register source its `quality` block (the "3a Source Quality" cells, word for word), `screening_pending`, and any missing link. Titles, authors and summaries stay as they are unless you pass `--refresh-source-text`.
- `milestones.json`: on the WBE timeline milestones, `status`, `status_basis`, `success_criterion`, `main_bottleneck`, `source_ids`, `assessment_confidence`, `applies_to`, `criterion_met`, `evidence_entries`, `timing` and `note` (tab 1a). `source_ids` is set mechanically to the sources the milestone's 1a row cites: first the source of every entry in `evidence_entries` (the register's "Source ID" column), then every S-id written in the row's "Success criterion", "Evidence (entries and basis)", "Main bottleneck", "Timing (dated sources only)" and "Note" cells, in that order. A range like "S20-S22" counts as every id in it. Each source appears once, where it is first seen, and an id the "3 Sources" tab doesn't list stops the import. Any other source ids the milestone had are dropped. The sample milestones (BCI and neuromorphic) are never touched.

Text goes in word for word. The only edits are tidying spaces and a short list of exact fixes (`GLITCH_FIXES` in `shared/sf_shared/import_workbook.py`), and the import prints every one. It also prints the cells it didn't use and any disagreements between tabs, for Vilija to look at. It never settles a disagreement itself.

Most of the fixes repair glitches in the sheet, like a mangled dash or a lost opening quote. The last block, "Site wording" (added 2026-11-20), rewrites the cells that point into the workbook (a tab name like "see 1a Milestones", "per sheet summary", codes no tab defines such as D05 or "IC") or have a typo, and makes US spellings British to match the rest of Vilija's text. That way a reader who never sees the workbook can follow every page. Each fix names its cell by tab, row id and column header. The row id is the entry, link, risk, checklist, source or milestone row id, the family name, a framework id ("RF6"), for "4.1 Artificial Minds" and "4 Alignment Judgment" the family name and the row's label ("WBE: 4 Copied emulations", "Neuromorphic AI: Neuromorphic hardware"), or for the Codebook the type and the code as the sheet writes them ("Rating: Unclear"). A fix applies only while the cell still says exactly its "before" text. Once Vilija changes a cell, the import lists that fix as no longer needed and keeps her new text, so check the new text and remove or update the fix. To change the site's wording of a fixed cell, change the fix's "after" text and import again. Never edit those cells in the JSON: the next import puts the fixed text back.

Before writing, it checks a copy of this folder with the validator. If the check fails, nothing is written.

If the milestones are live in the database (see "Where each thing is edited"), the timeline reads them from there, so re-import them after a workbook import: `flask --app sf_api content import-milestones ../content/milestones.json --replace` (in `backend/`). Otherwise the timeline won't show the workbook's updates.

### What's in scorecard.json

| Key | Workbook tab | What it holds |
|---|---|---|
| `generated` | | A note that the file is written by the import. |
| `workbook` | Overview | `title` (the tab's first cell), `version`, and `source_sha256`, a fingerprint of the imported file. |
| `overview` | Overview | `purpose`, `principles` and `update_protocol`, word for word. The import still stores `update_protocol`, but the methodology page no longer prints it: the steps in its section 08 ("new-sources") are site text adapted from it, since the workbook's steps name tabs and columns readers never see. When the workbook's protocol changes, update those steps in `frontend/app/methodology/` by hand. |
| `codebook` | Codebook | Every row in sheet order: `type`, `code`, `family` (the sheet's word, like "WBE" or "All") and `definition`. |
| `frameworks` | 9 Reference Frameworks | `id` ("RF1"), `reference`, `url`, `contributes` and `applied`. |
| `milestone_categories` | 1a Milestones | The nine category header rows: `id` ("M1"), `category`, `label` and `question`. |
| `milestone_assessments` | 1a Milestones | Every family row: `family`, `milestone` ("M1"), `category`, `applies_to`, `success_criterion`, `status`, `criterion_met`, `evidence` (word for word), `evidence_entries` (the entry ids in it, leaving out any marked "not admissible"), `bottleneck`, `timing`, `confidence` and `note`. BCI M1 and NM M1 have two rows each. |
| `entries` | 0 Evidence Register | One per entry: `id` ("E001"), `source_id` ("s01"), `register_id` ("S01"), `locator`, `claim`, `codes` (column E split on ";"), `family` (or `cross_family`), `feeds` (each rating it feeds: `family`, `target` such as `alignment` or `M6`, `direction` and an optional `note`), `feeds_text` (column G word for word), `source_type_independence`, `outcome`, `alignment_problem`, `scenarios`, `stage`, `directness`, `role` and `basis`. |
| `links` | 2 Theory of Change | One per causal link: `id` ("WBE-O-L1"), `family`, `scenario_code`, `scenario`, `step`, `outcome`, `claim`, `status`, `supporting`, `contrary` and `qualifying` (entry ids), `best_directness`, `assumption` and `objection`. |
| `risks` | 7 Overall Risks | One per risk: `id` ("R01"), `risk`, `families`, `domain`, `category`, `exposed`, `severity`, `likelihood`, `reversibility`, `detectability`, `remedies`, `control`, `confidence` and `entries`. |
| `governance` | 8 Governance Checklist | One per item: `id` ("G01"), `family`, `question`, `status`, `entries` and `summary`. |
| `scope_notes` | 1 Scope | The lines above the tab's header (its title, key question and time horizon bands). |
| `cross_family_scope` | 1 Scope | The Cross-family row: `intervention`, `deployment_scenario`, `source_ids` and `source_ids_text`, named as on `scope`. |

The validator checks this file like the others. Ids are unique, every entry, link, risk, checklist id and milestone row the files name exists, every entry's source is in `sources.json` under its register id, and a link's family matches the prefix of its id. These are existence checks only: when two tabs list different entries for the same thing, that is for the workbook to settle.

### The one-time move to v0.4

Before the first import, `python -m sf_shared.migrate_v04 --content content/ --removed-text removed-text.json` moved this folder from the v0.1 shapes. On each page it renamed `sample` to `unreviewed_ai_sections`, removed the v0.1 sections the workbook replaces (`theory_of_change`, `evidence_register`, `evidence_gap`, `artificial_minds_assessment`, the v0.1 `scope` and `alignment_assessment`, the v0.1 Intelligence Curse questions and the old welfare fields), and gave the risk rows their new shape. It wrote a placeholder `scorecard.json` with empty tables. It lists every value it removed. It is kept for the record; running it again changes nothing.

## Checking your work

The validator checks every file and lists every problem it finds, with the exact place to look.

The first time, open a terminal in the top folder of the repo and run:

```
python3 -m venv .venv
source .venv/bin/activate
pip install -e "shared[dev]"
```

(On Windows, the second line is `.venv\Scripts\activate`.) If the checker ever says `No module named ...`, run the `pip install` line again to pick up anything new.

After that, every time you want to check, run this from the top folder:

```
source .venv/bin/activate
python -m sf_shared.validate content/
```

If everything is fine, you'll see something like:

```
OK: 13 milestones, 37 sources, 3 technologies, 1 post, 121 evidence entries
```

You might also see a line starting with `Warning:` above it, such as "Warning: 27 AI-suggested claims in sample records or pages with unreviewed AI sections have no reviewer." A warning doesn't fail the check. It's a reminder that the samples and the AI-drafted outline sections still hold AI text somebody has to review. The warning about a placeholder tracker is the same kind of reminder (see "Rating cards").

Otherwise you'll get one line per problem, then a count:

```
milestones[3] (bci-medical-approval).forecasts[0].quote: required (every forecast needs its exact quote). Paste the exact words from the source.

FAILED: 1 problem in content
```

Read the location from left to right: the 4th milestone in the file (counting starts at 0), whose id is `bci-medical-approval`, then its first forecast, then the `quote` field. Fix it, save, and run the check again.

The same check runs on GitHub whenever someone pushes a change, so a broken file can't reach the site. If you see a red X on GitHub, click "Details" to see the same messages.

## Common errors

| Message | What it means and how to fix it |
|---|---|
| `forcasts: unknown field. Did you mean "forecasts"?` | A field name is misspelled. Fix the spelling. |
| `forecasts: required` | A field is missing. Copy it from an existing entry. It often shows up together with the misspelling above. |
| `not valid JSON (line 12, column 5: Expecting ',' delimiter)` | Usually a missing comma near that line, a comma after the last item, or a curly quote. Look at that line and the one above it. |
| `quote: required (provenance is source)` | A `source` claim with no quote. Paste the exact words, or change the provenance to `team` or `unclear`. |
| `source_ids: needs at least one source id when provenance is source` | Add the id of the source the quote comes from. |
| `no source with id "smith-2025" in sources.json` | The id is misspelled, or the source hasn't been added yet. It also happens if you put a register id like `S02` in `source_ids`. Use the source's id, `s02`. |
| `register_id: must look like "S02"` | A register id needs a capital S and at least two digits: `S02`, not `s02` or `S2`. |
| `register_id: "S02" is already used by` | Two sources have the same register id. Check the Notion database for a duplicate row. |
| `no milestone with id "..." in milestones.json` | A `depends_on` or `milestone_ids` entry points to a milestone that doesn't exist. Check the spelling. For a milestone made in admin, run `export-milestones` first (see "Rating cards"). |
| `is a sample milestone` | A real milestone, or any scorecard row, links to a sample milestone, which the public site leaves out. Link to a real one. |
| `is a bci milestone, and this is the wbe page` | A rating can only link to milestones of its own technology. |
| `dependency cycle: a -> b -> a` | Two milestones each depend on the other. Remove one of the links. |
| `Input should be a valid integer (got "2045")` | A year in quotes. Remove the quotes. |
| `Input should be 'possible', 'widely_available' or 'actually_helping' (got "Possible")` | A value that isn't on the list. Values are lowercase with underscores. |
| `earliest and latest are both null` | A forecast with no years. Give at least one year, or set `never` to `true`. |
| `must be null when never is true` | A "never" forecast that also has a year. Set the years to `null`. |
| `reviewed_by: required when provenance is ai` | Someone has to check an AI suggestion and put their name here before it goes public. |
| `isn't a field the site can mark as AI-suggested` | An `ai_suggested_fields` entry the site can't label. Use one of the field names the message lists. |
| `"other" needs a note` | Source credibility, scorecard rows and assessments can't use `other`. Pick the closest of the other reasons. |
| `must be null on a risk row` | A risk row has a `rating` (or an `unclear_reason`). Risk rows have `severity` and `likelihood` instead. |
| `only risk rows (scale "risk") have one` | `severity` or `likelihood` is on a `case` row. Remove it. |
| `no evidence entry with id "E404" in scorecard.json` | An entry id that the workbook's register doesn't have. Check the id, or import the workbook again. |
| `no causal link with id`, `no risk with id`, `no governance checklist item with id`, `milestone row` | A code in `scorecard.json` names something the workbook doesn't define. Fix it in the workbook and import again. |
| `doesn't match the id "WBE-O-L1", which names wbe` | A causal link's `family` or `scenario_code` differs from its id's prefix. |
| `not a field here` | The field belongs to another kind of record, or was removed in v0.4 (like `sample` on a page, or `potential_severity`). Remove it. |
| `needs exactly one *italic* word or phrase` | The technology page `headline` has no asterisks, or more than one pair. |
| `scorecard[3].id: "governance-risk" is already used by scorecard[2]` | Two rows on one page have the same `id` (or the same `dimension`). Each row needs its own. |
| `Every page needs the same scorecard rows as technologies[0] (wbe)` | A page has a row the first page doesn't, is missing one, or has them in another order. Make the three pages match. |
| `A row means the same thing on every page` | A row has a different `dimension`, `scale` or `problem` on another page. Change it on all three pages at once. |
| `is taken by the compare page's` | A row id clashes with one of the compare page's own views. Pick another id. |
| `doesn't match the scorecard row "alignment-case"` | An assessment's rating, confidence or unclear reason differs from its scorecard row. Change both together. |
| `Each change starts where the one before it ended` | A history entry's `rating_before` or `confidence_before` doesn't match the entry above it. Fix the values, or add the missing change. |
| `The newest change has to end at the current rating` | The row's `rating` (or `confidence`) changed without a history entry. Add one at the end of `history`. |
| `Keep the history oldest first` | Move the entries so the dates run from oldest to newest. |
| `last_updated: required when there is a history` | Set `last_updated` to the date of the newest change, or later. |
| `name the source or sources that caused this change` | A history entry's `note` needs `source_ids`. |
| `must be empty while placeholder is true` | Remove `"placeholder": true` once the team has checked the tracker, then record the change. |
| `true, but the row has nothing to mark` | A tracker has `"placeholder": true` but no example fields. A `what_would_change` that is `unclear` with `search_incomplete` doesn't count, because the card shows it as not assessed. Add the fields, or remove the flag. |
| `is in the future. Check the year` | A history date or `last_updated` is after tomorrow. Usually a typo in the year. |
| `put the value of "summary" in double quotes` | A blog post header value the site would misread. Wrap the whole value in `"..."`. |
| `unclear_reason: required when provenance is unclear` | Say why it's unclear, using one of the reasons above. |
| `confidence: required when there is an estimate` | Set `confidence` to `high`, `medium` or `low`. |
| `must be lowercase letters, numbers and single hyphens` | An id or slug with capitals, spaces or underscores. `bci-medical-approval` is fine, `BCI Medical_Approval` isn't. |
| `has an em dash`, `has an en dash` | See the style rules below. |

## Style rules for all text

- No em dashes or en dashes (the long and medium-length dashes). Use a period, comma, colon or parentheses instead, and a hyphen for a range. The validator checks every file for both.
- Write the way you'd explain it to a smart friend who isn't a specialist: plain and concrete.
- Real entries don't start with "Sample." That prefix marks the worked examples.
