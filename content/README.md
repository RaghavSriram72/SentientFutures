# Filling in the content

This folder is everything the public site shows. The timeline, the source list, the technology pages and the blog are all built from these files, and nothing on the site is typed in anywhere else. If you change a file here, the site changes the next time it's built.

You don't need to know how to program to edit these files, but you do need to be careful, because the format is strict. It's strict so that a checker (the validator) can read every file and tell you exactly what's wrong and where. This guide covers importing sources from Notion, adding a source, a milestone and a forecast, how the technology pages are laid out, and how to run the checker and read its messages.

## What's in here

| File | What it holds |
|---|---|
| `milestones.json` | The timeline. One entry per milestone, with its forecasts inside it. |
| `sources.json` | Every paper, report, post, talk, podcast or book we cite. Most of them come from the team's Notion database. |
| `technologies.json` | The three technology pages: WBE, BCI and neuromorphic AI. |
| `posts/` | Blog posts, one Markdown file each. |
| `README.md` | This guide. |

Entries with `"sample": true` are placeholders, and the site tags them as samples. There are two kinds:

- Worked examples: the BCI and neuromorphic milestones, and the seven sources whose ids start with `sample-`. These are made up and their sources are fictional. Most of their text starts with "Sample." (source summaries start with "Placeholder summary."). The sample sources stay in `sources.json` only because the sample milestones cite them.
- AI-drafted outlines: the BCI and neuromorphic technology pages. An AI wrote them and nobody on the team has reviewed them yet. Their text doesn't start with "Sample.", but every line carries an "AI-suggested · not yet reviewed" tag.

The WBE page and the eight WBE milestones are real team content. They come from the team's populated WBE scorecard, so they have `"sample": false` and every sentence is marked `team` (a few milestone lines are `unclear` where we haven't looked yet). The sources with ids `s01` to `s30` are real too. They come from the team's Notion database (see "Importing sources from Notion" below), and their summaries are the team's own.

Only a sample can show AI text that nobody has checked. The validator prints a warning with a count of those lines, and each one needs a `reviewed_by` before the sample flag comes off. To add something new, copy the entry closest to it and replace every value. Real entries leave `sample` out or set it to `false`. We'll delete or review the samples once there's enough real content.

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
| `other` | None of these fit. Explain in `unclear_note`. Only claims can use `other`. Source credibility, scorecard rows and assessments have no note field, so they need one of the four reasons above. |

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
| `register_id` | The team's register id, like `"S02"`: a capital S and at least two digits. No two sources can share one. The technology pages' evidence registers find sources by this id. Leave it out, or use `null`, for a source that isn't in the register. |
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
| `added_by` | Who added the source to the Notion database, or `null`. |
| `reviewed_by`, `reviewed_on` | Who checked this entry, and when (`"2026-10-27"`). Required whenever `ai_suggested_fields` isn't empty. |

The five rubric fields (`evidence_type`, `directness`, `independence`, `relevance` and `credibility`) can each be `null`, which means not rated yet. Leave a rating `null` until someone has read the source and decided. If an AI suggests a rating, list the field in `ai_suggested_fields` and have a person check it.

## Adding a milestone

A milestone is one step a technology has to pass, like "a high-bandwidth implant is approved for medical use." Each one sits on the timeline as its own track.

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
| `category` | `technical_capability`, `reliability_robustness`, `safety_welfare_assurance`, `scalable_production`, `economic_viability`, `legal_regulatory`, `institutional_legitimacy` or `equitable_access`. |
| `status` | `not_demonstrated`, `prototype` (shown once, in limited conditions), `replicated` (shown more than once, by more than one group), `mature` (routine) or `not_claimed` (none of our current sources claims the proposal will do this, as in the scorecard's "if claimed" rows). |
| `status_basis` | A claim saying why it has that status. |
| `achieved_in` | The year it happened, or `null` if it hasn't. |
| `achieved_in_basis` | `null`, unless `achieved_in` is set. Then it must be a `source` claim with a quote showing it happened. |
| `confidence` | `high`, `medium` or `low`: how sure we are. Required when `estimate` is set. You can also set it without an estimate (the WBE milestones carry the scorecard's Low); otherwise use `null`. |
| `summary` | A claim: what this milestone is and why it matters. |
| `success_criterion` | A claim: how we'd know it has happened. Be concrete ("40 words per minute, no implant, in a peer-reviewed study"). |
| `main_bottleneck` | A claim: what's holding it back. |
| `depends_on` | A list of milestone ids that have to happen first, or `[]` if there are none. |
| `source_ids` | A list of every source linked to this milestone, including the ones its forecasts and claims cite. The panel lists these. |
| `estimate` | Our own range, or `null` if the team hasn't agreed on one. See "The team estimate" below. |
| `forecasts` | A list of forecasts from sources (see "Adding a forecast"), or `[]` if there are none yet. |
| `disagreement_override` | Usually `null`. See "Disagreement" below. |
| `disagreement_note` | An optional claim explaining a disagreement in words, or `null`. |
| `would_move_earlier` | A list of claims: evidence that would make this happen sooner. It needs at least one. If we don't know, use one `unclear` claim. |
| `would_move_later` | The same, for evidence that would push it later. |
| `artificial_minds_questions` | A list of claims about the consciousness, moral status, identity or welfare questions this raises. `[]` is fine. |

Two notes on the WBE milestones. The team's scorecard doesn't assign stages yet, so for now reliability, technical capability, and safety and welfare assurance are `possible`, and the other five are `widely_available`. Change them when the team decides. Their evidence comes from the scorecard's register (S02 and S13, which are `s02` and `s13` in `sources.json`). Each WBE milestone lists those ids in `source_ids` and again in `status_basis.source_ids`, so the panel links the sources under the status.

### The team estimate

`estimate` is the range the team stands behind. When it's set, the timeline draws it as a solid bar, and every forecast stays visible next to it.

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

`earliest` can't be later than `latest`, and a forecast with `never: false` needs at least one year. Years after 2100 are fine: the timeline shows them in an "After 2100" column, with the real year in the panel.

If a source gives a probability ("50% by 2050"), write the year it gives and put the probability in `claim`: `"50% chance by 2050"`.

## Writing a blog post

Each post is a Markdown file in `posts/`, with a short header (called frontmatter) between two `---` lines:

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

The BCI and neuromorphic pages are still outlines. They use five lists of claims: `claims_to_solve`, `mechanism`, `strongest_case`, `strongest_objections` and `artificial_minds_questions`. A page with a populated scorecard can leave these as `[]`, as the WBE page does.

### Populated scorecard sections

These follow the sections of the team's scorecard (v0.1). The WBE page fills in all of them.

| Field | Scorecard section | What goes in it |
|---|---|---|
| `scope` | 1. Scope | Five claims (`intervention`, `deployment_scenario`, `affected_groups`, `time_horizon` and `comparator`), plus `problem`: `alignment`, `intelligence_curse` or `both`. |
| `theory_of_change` | 2. Theory of change | The causal chain, one claim per step, in order. |
| `alternatives` | 2. Theory of change | The most credible alternatives and counterarguments, one claim each. |
| `evidence_register` | 3. Evidence register | One row per claim or causal step (see below). |
| `alignment_assessment` | 4. Alignment assessment | An assessment (see below). |
| `artificial_minds_assessment` | 4.1 Artificial minds | Four claims: `consciousness`, `moral_status`, `identity` and `welfare`. |
| `intelligence_curse_assessment` | 5. Intelligence Curse assessment | An assessment (see below). |
| `welfare_governance` | 6. Welfare and governance | Claims for `exposed`, `harms`, `severity`, `detectability`, `control` and `rationale`, plus a `confidence`. |
| `evidence_gap` | 8. Synopsis | The primary evidence gap, as one claim. |

An evidence register row looks like this:

```json
{
  "claim": "Regulatory and moral bottlenecks could delay WBE.",
  "supporting_ids": ["S02"],
  "contrary_ids": [],
  "evidence_type": "Argument",
  "directness": "adjacent",
  "limitation": "A workshop-level claim, with no policy analysis or empirical test behind it.",
  "independence": "Unclear",
  "provenance": "team"
}
```

`supporting_ids` and `contrary_ids` hold the register ids, and an empty list means we found none in our current sources. `evidence_type` and `independence` are written the way the register words them ("Argument / review", "Mixed", "Not applicable"). `directness` is `direct`, `adjacent` or `remote`, and `provenance` is `team` or `ai`.

The register ids (S02, S13, S15) are the team's own numbering. In `supporting_ids` and `contrary_ids`, write them that way, and the site links each one to the source with that `register_id`. A claim's `source_ids` takes the source's `id` instead, so a claim whose text mentions S02 lists `"s02"`, and the site shows a link to the source under the claim.

The alignment and Intelligence Curse assessments have the same shape:

```json
"alignment_assessment": {
  "mechanism": { "text": "The problem it addresses, or the mechanism claimed.", "provenance": "team" },
  "questions": [
    {
      "question": "Could a more capable AI undermine or get around the benefit?",
      "answer": { "text": "Unclear. None of our current sources tests this.", "provenance": "team" }
    }
  ],
  "rating": "unclear",
  "confidence": "low",
  "unclear_reason": "underspecified_proposal",
  "reason": { "text": "Why it got this rating.", "provenance": "team" },
  "decisive_question": { "text": "The open question that would settle it.", "provenance": "team" }
}
```

`questions` holds the scorecard's column questions, each with its answer. `rating` uses the case ratings below, and an `unclear` rating needs an `unclear_reason` other than `other`.

### The scorecard summary

`scorecard` is the rating synopsis from section 8 of the team's scorecard. Every page has the same six rows, in this order:

| `dimension` | `scale` | `problem` |
|---|---|---|
| Alignment case | `case` | `alignment` |
| Intelligence Curse case | `case` | `intelligence_curse` |
| Human welfare risk | `risk` | `null` |
| Artificial-mind welfare and rights risk | `risk` | `null` |
| Governance risk | `risk` | `null` |
| Safeguard adequacy | `case` | `null` |

Human welfare risk is about harm to people: mental privacy, autonomy and manipulation, workplace surveillance and neuromanipulation, and dependency and deskilling. Harm to the artificial minds themselves has its own row.

A `case` row is rated `strong`, `moderate`, `weak`, `unclear` or `not_claimed`, and a `risk` row `high`, `medium`, `low` or `unclear`. Every row also has a `confidence` and a `basis` claim. The rules:

- An `unclear` rating needs `unclear_reason`, and it can't be `other`, because a row has nowhere to write the note. Pick the closest reason and explain the rest in the basis.
- A `low` risk needs a `source` basis. We never call a risk low just because nobody has studied it.
- `not_claimed` means the proposal doesn't claim that outcome, which is different from `weak` or `unclear`. Don't also list that outcome under `claims_to_solve`.
- `potential_severity` (`high`, `medium` or `low`) is for risk rows only. Use it when the rating is still `unclear` but the team has judged how bad the harm could be. The WBE scorecard's "Unclear, with potentially high severity" is written as `"rating": "unclear"` with `"potential_severity": "high"`. Leave it out when nobody has made that judgment, as on the BCI and neuromorphic pages.

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
OK: 13 milestones, 36 sources, 3 technologies, 2 posts
```

You might also see a line starting with `Warning:` above it, such as "Warning: 39 AI-suggested claims in sample records have no reviewer." A warning doesn't fail the check. It's a reminder that the samples still hold AI text somebody has to review before they become real entries.

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
| `no milestone with id "..." in milestones.json` | A `depends_on` entry points to a milestone that doesn't exist. Check the spelling. |
| `dependency cycle: a -> b -> a` | Two milestones each depend on the other. Remove one of the links. |
| `Input should be a valid integer (got "2045")` | A year in quotes. Remove the quotes. |
| `Input should be 'possible', 'widely_available' or 'actually_helping' (got "Possible")` | A value that isn't on the list. Values are lowercase with underscores. |
| `earliest and latest are both null` | A forecast with no years. Give at least one year, or set `never` to `true`. |
| `must be null when never is true` | A "never" forecast that also has a year. Set the years to `null`. |
| `reviewed_by: required when provenance is ai` | Someone has to check an AI suggestion and put their name here before it goes public. |
| `isn't a field the site can mark as AI-suggested` | An `ai_suggested_fields` entry the site can't label. Use one of the field names the message lists. |
| `"other" needs a note` | Source credibility, scorecard rows and assessments can't use `other`. Pick the closest of the four other reasons. |
| `only risk rows (scale "risk") can have a potential severity` | `potential_severity` is on a `case` row. Remove it. |
| `needs exactly one *italic* word or phrase` | The technology page `headline` has no asterisks, or more than one pair. |
| `put the value of "summary" in double quotes` | A blog post header value the site would misread. Wrap the whole value in `"..."`. |
| `unclear_reason: required when provenance is unclear` | Say why it's unclear, using one of the reasons above. |
| `confidence: required when there is an estimate` | Set `confidence` to `high`, `medium` or `low`. |
| `must be lowercase letters, numbers and single hyphens` | An id or slug with capitals, spaces or underscores. `bci-medical-approval` is fine, `BCI Medical_Approval` isn't. |
| `has an em dash` | See the style rules below. |

## Style rules for all text

- No em dashes or en dashes (the long and medium-length dashes). Use a period, comma, colon or parentheses instead. The validator checks every file for em dashes.
- Write the way you'd explain it to a smart friend who isn't a specialist: plain and concrete.
- Real entries don't start with "Sample." That prefix marks the worked examples.
