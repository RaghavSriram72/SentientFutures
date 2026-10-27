# Filling in the content

This folder is everything the public site shows. The timeline, the source list, the technology pages and the blog are all built from these files, and nothing on the site is typed in anywhere else. If you change a file here, the site changes the next time it's built.

You don't need to know how to program to edit these files. You do need to be careful, because the format is strict. That's on purpose: a checker (the validator) reads every file and tells you exactly what's wrong and where. This guide walks through adding a source, a milestone and a forecast, then explains how to run the checker and what its messages mean.

## What's in here

| File | What it holds |
|---|---|
| `milestones.json` | The timeline. One entry per milestone, with its forecasts inside it. |
| `sources.json` | Every paper, report, blog or forum post we cite. |
| `technologies.json` | The three technology pages (WBE, BCI, neuromorphic). |
| `posts/` | Blog posts, one Markdown file each. |
| `README.md` | This guide. |

Every entry with `"sample": true` is a placeholder, and the site marks it as a sample. There are two kinds:

- **Worked examples** (the milestones and sources). They're made up: their sources are fictional, and most of their text starts with "Sample."
- **AI-drafted outlines** (the three technology pages, for now). An AI wrote them and nobody on the team has reviewed them yet. Their text doesn't start with "Sample.", but every line carries an "AI-suggested · not yet reviewed" tag.

A sample is the only kind of entry that can show AI text nobody has checked. The validator prints a warning counting those lines, and every one needs a `reviewed_by` before the sample flag comes off. Use the samples as templates: copy one, then replace every value. Real entries leave `sample` out (or set it to `false`). We'll delete or review the samples once there's enough real content.

## Five JSON rules that prevent most errors

The files are JSON. JSON is picky, but it only has a few rules:

1. **Text goes in straight double quotes:** `"like this"`. Word and Google Docs turn quotes into curly ones (“ ”), which JSON doesn't accept. Paste into a plain text editor, not a word processor.
2. **Numbers, `true`, `false` and `null` go without quotes:** `2045`, not `"2045"`. `null` means "nothing here" and is different from `"null"` or `""`.
3. **Commas go between items, never after the last one.** `["a", "b"]` is fine. `["a", "b",]` breaks the file.
4. **Field names (the part before the colon) must match the samples exactly:** lowercase, with underscores. `would_move_earlier`, not `wouldMoveEarlier` or `would move earlier`.
5. **A double quote inside text needs a backslash:** `"text": "She called it \"a long shot\"."`

A good editor helps a lot. VS Code (free) underlines broken JSON in red as you type. GitHub's web editor works too.

## Provenance: where each sentence comes from

This is the most important idea in the whole site. Every sentence we show carries a label saying where it came from, and the site styles each kind differently so readers can always tell them apart. In the files, any piece of text that appears on the site is written as a small block called a **claim**:

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
| `team` | Our own reading or interpretation. | Nothing extra. You can still list `source_ids` it's based on. | An "Our read" tag |
| `ai` | Suggested by an AI model. | `reviewed_by`: the name of the person who checked it. Only sample entries may leave it out. | An "AI-suggested · checked by ..." label, or "AI-suggested · not yet reviewed" on a sample |
| `unclear` | Genuinely uncertain. | `unclear_reason`, and `unclear_note` when the reason is `other` (and only then). | Hatching and "Unclear · reason" |

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
| `other` | None of these fit. Explain in `unclear_note`. Only claims can use `other`: source credibility and scorecard ratings have no note field, so they need one of the four reasons above. |

### The golden rule: no exact quote means team or unclear, never source

`source` is a promise to the reader that the source says this, in these words. If you can't paste the exact words, it isn't `source`. Use `team` if it's our reading of the evidence, or `unclear` if we don't know. Never paraphrase into the `quote` field, and never mark something `source` because you remember a paper saying something like it.

Keep quotes short (the limit is 300 characters). Quote the smallest passage that supports the sentence.

## Adding a source

Add every source to `sources.json` first, because milestones and forecasts point to sources by their id.

1. Open `sources.json` and copy one of the sample entries, from its `{` to its `}`.
2. Paste it at the end of the list, before the final `]`. Put a comma after the entry above it.
3. Replace every value, using the field guide below.

| Field | What to put |
|---|---|
| `id` | A short, permanent name: first author, year and a keyword, like `"sandberg-2008-roadmap"`. Lowercase letters, numbers and hyphens only. Never change it once it's public. |
| `title` | The full title. |
| `authors` | A list, even for one author: `["Anders Sandberg", "Nick Bostrom"]`. An organization is fine as an author. |
| `year` | The year it was published, as a number. |
| `url` | A link starting with `https://`. Prefer the DOI or arXiv page. |
| `doi`, `arxiv_id`, `venue` | Fill in if known, otherwise `null`. Venue is the journal, conference, blog or publisher. |
| `source_type` | `peer_reviewed`, `preprint`, `blog`, `report` or `forum_post`. |
| `kind` | `argument` if it proposes or criticizes neuroengineering as a response to alignment or the Intelligence Curse. `milestone_evidence` if it's technical progress that bears on a milestone. |
| `technology` | A list of the technologies it's about: any of `wbe`, `bci`, `neuromorphic`, `hybrid`. |
| `problem` | `alignment`, `intelligence_curse`, `both`, or `null` if it's about neither directly. |
| `evidence_type` | `argument`, `simulation`, `experiment`, `deployment` or `review`. |
| `directness` | How close it is to our scenario: `direct`, `adjacent` or `remote`. |
| `independence` | `independent` (no stake), `non_biased` (some connection, no obvious stake) or `affiliated` (the author or funder has a stake). |
| `relevance` | `core`, `supporting`, `peripheral` or `not_relevant`. These values are still drafts. |
| `credibility` | `strong`, `adequate`, `weak` or `unclear`. Also drafts. If `unclear`, set `credibility_unclear_reason` to one of the unclear reasons above, except `other` (a source has nowhere to write the note). |
| `summary` | A claim in our own words (usually `team`). Don't paste the abstract: we write our own summary for copyright reasons. |
| `ai_suggested_fields` | A list of the field names an AI filled in, like `["evidence_type"]`, so the site can label them. `[]` if a person filled in everything. Allowed: `source_type`, `kind`, `technology`, `problem`, `evidence_type`, `directness`, `independence`, `relevance`, `credibility` and `credibility_unclear_reason`. Don't list `summary`: if an AI wrote it, set the summary's own `provenance` to `ai`. |
| `reviewed_by`, `reviewed_on` | Who checked this entry, and when (`"2026-10-27"`). Required whenever `ai_suggested_fields` isn't empty. |

## Adding a milestone

A milestone is one step a technology has to pass, like "a high-bandwidth implant is approved for medical use." Each one sits on the timeline as its own track.

1. Open `milestones.json` and copy the sample closest to what you're adding. The samples cover the main cases:
   - `wbe-sample-mouse-connectome`: a team estimate plus two forecasts
   - `wbe-sample-human-emulation`: forecasts that disagree, including a "never"
   - `bci-sample-consumer-text`: a disagreement override
   - `bci-sample-agency`: no estimate and no forecasts yet
   - `neuro-sample-energy`: a milestone that has already happened
2. Paste it at the end of the list (comma after the entry above it), and replace every value.
3. Add any new sources to `sources.json`.
4. Run the validator (see below).

| Field | What to put |
|---|---|
| `id` | Technology plus a short name, like `"bci-medical-approval"`. Lowercase and hyphens. Never change it once it's public, because other milestones and links point to it. |
| `name` | The milestone as a short statement of what happens: "A non-invasive headset decodes text at typing speed." |
| `technology` | `wbe`, `bci`, `neuromorphic` or `hybrid`. |
| `stage` | `possible` (someone has shown it can be done), `widely_available` (cheap, reliable and accessible enough to matter) or `actually_helping` (measurably helping with alignment or human agency). |
| `category` | `technical_capability`, `reliability_robustness`, `safety_welfare_assurance`, `scalable_production`, `economic_viability`, `legal_regulatory`, `institutional_legitimacy` or `equitable_access`. |
| `status` | `not_demonstrated`, `prototype` (shown once, in limited conditions), `replicated` (shown more than once, by more than one group) or `mature` (routine). |
| `status_basis` | A claim saying why that status. |
| `achieved_in` | The year it happened, or `null` if it hasn't. |
| `achieved_in_basis` | `null`, unless `achieved_in` is set. Then it must be a `source` claim with a quote showing it happened. |
| `confidence` | `high`, `medium` or `low`: how sure we are of our estimate. Required when `estimate` is set, otherwise `null`. |
| `summary` | A claim: what this milestone is and why it matters. |
| `success_criterion` | A claim: how we'd know it has happened. Be concrete ("40 words per minute, no implant, in a peer-reviewed study"). |
| `main_bottleneck` | A claim: what's holding it back. |
| `depends_on` | A list of milestone ids that have to happen first. `[]` if none. |
| `source_ids` | A list of every source linked to this milestone, including the ones its forecasts and claims cite. The panel lists these. |
| `estimate` | Our own range, or `null` if the team hasn't agreed on one. See "The team estimate" below. |
| `forecasts` | A list of forecasts from sources. See "Adding a forecast". `[]` if there are none yet. |
| `disagreement_override` | Usually `null`. See "Disagreement" below. |
| `disagreement_note` | Optional claim explaining a disagreement in words, or `null`. |
| `would_move_earlier` | A list of claims: evidence that would make this happen sooner. At least one. If we don't know, use one `unclear` claim. |
| `would_move_later` | The same, for evidence that would push it later. At least one. |
| `artificial_minds_questions` | A list of claims about consciousness, moral status, identity or welfare questions this raises. `[]` is fine. |

### The team estimate

`estimate` is the range the team stands behind. When it's set, the timeline draws it as a solid bar, but every forecast stays visible next to it.

```json
"estimate": {
  "earliest": 2030,
  "latest": 2038,
  "basis": {
    "text": "Our range sits between the two forecasts, widened because proofreading speed is hard to predict.",
    "provenance": "team"
  },
  "set_by": "Vilija",
  "set_on": "2026-10-27"
}
```

`latest` can be `null` for "not before 2035, and we won't guess an end." Dates are always written `YYYY-MM-DD`. Remember to set `confidence` too.

### Disagreement

The site flags disagreement on its own. Under rule v0.2, two forecasts disagree when their windows are more than 10 years apart, or when one says "never" and the other gives a year. Two forecasts only count as the same forecaster (and are never compared) when both the forecaster name and the source match. A flagged milestone gets a "Sources disagree" badge, and all of its forecasts stay visible side by side.

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

A forecast is one prediction from one forecaster in one source, stored exactly as stated. We never average forecasts or turn a range into one year. Forecasts live inside their milestone's `forecasts` list. Here's one (a made-up example from the samples, so replace every value):

```json
{
  "id": "f3",
  "source_id": "sample-roadmap-report",
  "forecaster": "Example Author",
  "claim": "Feasible between 2045 and 2060",
  "quote": "The exact sentence from the source, copied word for word.",
  "quote_location": "p. 77",
  "made_in": 2021,
  "earliest": 2045,
  "latest": 2060,
  "never": false
}
```

| Field | What to put |
|---|---|
| `id` | `f1`, `f2`, `f3` and so on. Unique within the milestone. |
| `source_id` | The id of the source it comes from. Add the source to `sources.json` first. |
| `forecaster` | Who made it, in a way that identifies them: a person's name, or a group plus the source, like "Median respondent, Example Survey 2024". Avoid a generic label like "Median survey respondent". The timeline treats two forecasts as coming from the same forecaster only when both this name and the `source_id` match, and readers need the label to tell forecasts apart. |
| `claim` | The forecast in a few words, as shown on the site. |
| `quote` | The exact words from the source. Every forecast needs one. No quote, no forecast. |
| `quote_location` | Page, section, table or timestamp. `null` if there isn't one. |
| `made_in` | The year the forecast was made (usually the publication year). Not the year it predicts. |
| `earliest`, `latest`, `never` | The shape of the forecast. See the table below. |

The four shapes:

| The source says | `earliest` | `latest` | `never` |
|---|---|---|---|
| "in 2045" (a point) | `2045` | `2045` | `false` |
| "between 2045 and 2060" (a range) | `2045` | `2060` | `false` |
| "by 2045" | `null` | `2045` | `false` |
| "not before 2045" | `2045` | `null` | `false` |
| "never" | `null` | `null` | `true` |

`earliest` can't be later than `latest`. A forecast with `never: false` needs at least one year. Years after 2100 are fine: the timeline shows them in an "After 2100" column with the real year in the panel.

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

Put the date in quotes. When in doubt, put the value in double quotes too: the header is read as YAML, which misreads values that contain a colon, start with `#`, `-`, `?` or a quote mark, or look like a number, a date, `yes`/`no` or `null`. The validator reads the header the same way the site does and tells you which value to quote. The `slug` becomes the end of the post's web address, so keep it lowercase with hyphens, and make it unique. The site needs at least one post to build.

## The technology pages

`technologies.json` has one entry for each of `wbe`, `bci` and `neuromorphic`. Every section is a list of claims with the same provenance rules as above. Two extra rules:

- `headline` needs exactly one word or phrase in asterisks, which the site shows in italics: `"What if the first digital minds *were ours*?"`
- The scorecard follows the rating synopsis in the team's scorecard v0.1 (section 8), one row each: "Alignment case" and "Intelligence Curse case" (`scale: "case"`, with `problem` set to `alignment` or `intelligence_curse`), "Welfare risk" and "Governance risk" (`scale: "risk"`, `problem: null`), and "Safeguard adequacy" (`scale: "case"`, `problem: null`). Welfare risk here means harm to people: mental privacy, autonomy and manipulation, workplace surveillance and neuromanipulation, dependency and deskilling. Questions about the welfare of artificial minds go in `artificial_minds_questions` instead.
- A `case` row is rated `strong`, `moderate`, `weak`, `unclear` or `not_claimed`, and a `risk` row `high`, `medium`, `low` or `unclear`. An `unclear` rating needs `unclear_reason`, and it can't be `other` (a row has nowhere to write the note, so pick the closest reason and explain in the basis). A `low` risk needs a `source` basis: we never call a risk low just because nobody has studied it. `not_claimed` means the proposal doesn't claim that outcome, so don't also list it under `claims_to_solve`.

## Checking your work

The validator checks every file and lists every problem it finds, with the exact place to look.

**One-time setup.** In a terminal, from the top folder of the repo:

```
python3 -m venv .venv
source .venv/bin/activate
pip install -e "shared[dev]"
```

(On Windows, the second line is `.venv\Scripts\activate`.) If the checker ever says `No module named ...`, run the `pip install` line again to pick up anything new.

**Every time.** From the top folder of the repo:

```
source .venv/bin/activate
python -m sf_shared.validate content/
```

If everything is fine, you'll see something like:

```
OK: 15 milestones, 22 sources, 3 technologies, 1 post
```

You might also see a line starting with `Warning:` above it, such as "Warning: 56 AI-suggested claims in sample records have no reviewer." A warning doesn't fail the check. It's a reminder that the samples still hold AI text somebody has to review before they become real entries.

Otherwise you'll get one line per problem, then a count:

```
milestones[3] (bci-medical-approval).forecasts[0].quote: required (every forecast needs its exact quote). Paste the exact words from the source.

FAILED: 1 problem in content
```

Read the location from left to right: the 4th milestone in the file (counting starts at 0), whose id is `bci-medical-approval`, its first forecast, the `quote` field. Fix it, save, and run the check again.

The same check runs on GitHub whenever someone pushes a change, so a broken file can't reach the site. If you see a red X on GitHub, click "Details" to see the same messages.

## Common errors

| Message | What it means and how to fix it |
|---|---|
| `forcasts: unknown field. Did you mean "forecasts"?` | A field name is misspelled. Fix the spelling. |
| `forecasts: required` | A field is missing. Copy it from a sample. Often appears together with the misspelling above. |
| `not valid JSON (line 12, column 5: Expecting ',' delimiter)` | Usually a missing comma near that line, a comma after the last item, or a curly quote. Look at that line and the one above it. |
| `quote: required (provenance is source)` | A `source` claim with no quote. Paste the exact words, or change the provenance to `team` or `unclear`. |
| `source_ids: needs at least one source id when provenance is source` | Add the id of the source the quote comes from. |
| `no source with id "smith-2025" in sources.json` | The id is misspelled, or the source hasn't been added yet. |
| `no milestone with id "..." in milestones.json` | A `depends_on` entry points to a milestone that doesn't exist. Check the spelling. |
| `dependency cycle: a -> b -> a` | Two milestones each depend on the other. Remove one of the links. |
| `Input should be a valid integer (got "2045")` | A year in quotes. Remove the quotes. |
| `Input should be 'possible', 'widely_available' or 'actually_helping' (got "Possible")` | A category value that isn't on the list. Values are lowercase with underscores. |
| `earliest and latest are both null` | A forecast with no years. Give at least one year, or set `never` to `true`. |
| `must be null when never is true` | A "never" forecast that also has a year. Set the years to `null`. |
| `reviewed_by: required when provenance is ai` | Someone has to check an AI suggestion and put their name here before it goes public. |
| `isn't a field the site can mark as AI-suggested` | An `ai_suggested_fields` entry the site can't label. Use one of the field names the message lists. |
| `"other" needs a note to explain it` | Source credibility and scorecard ratings can't use `other`. Pick the closest of the four other reasons. |
| `put the value of "summary" in double quotes` | A blog post header value the site would misread. Wrap the whole value in `"..."`. |
| `unclear_reason: required when provenance is unclear` | Say why it's unclear, using one of the reasons above. |
| `confidence: required when there is an estimate` | Set `confidence` to `high`, `medium` or `low`. |
| `must be lowercase letters, numbers and single hyphens` | An id or slug with capitals, spaces or underscores. `bci-medical-approval` is fine; `BCI Medical_Approval` isn't. |
| `has an em dash` | See the style rules below. |

## Style rules for all text

- **No em dashes.** That's the long dash. Use a period, comma, colon or parentheses instead. The validator checks every file for it.
- Write the way you'd explain it to a smart friend: conversational, concrete, no filler.
- Real entries don't start with "Sample." That prefix marks the worked examples.
