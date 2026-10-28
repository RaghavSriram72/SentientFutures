# The gold set

The gold set is a list of papers the team has labeled by hand. Before we trust the AI's first pass on new papers, we run it on these and check how often it agrees with you. The plan calls for 60 to 100 papers, including 20 to 30 near misses, and the AI should catch at least 90% of the relevant ones.

## Filling in gold_v1.csv

Open `gold_v1.csv` in a spreadsheet (Google Sheets, Excel or Numbers), add one row per paper, and save it as CSV again. The three rows whose id starts with `EXAMPLE` show the format. The eval skips them, so delete them once you have real rows.

| Column | What to write |
|---|---|
| `id` | The arXiv id (`2411.18526`) or the DOI (`10.3389/fnhum.2022.806517`). A link to either works too. The eval fetches the abstract from this. |
| `title` | The paper's title. It's only used to make the report readable, and when the abstract can't be fetched. |
| `label` | `relevant` if you'd want the paper in the review queue, `not_relevant` if not. |
| `kind` | `argument` or `milestone_evidence`. Leave it empty for papers that aren't relevant. |
| `technology` | `wbe`, `bci`, `neuromorphic` or `hybrid`. Separate several with a semicolon: `bci;wbe`. |
| `problem` | `alignment`, `intelligence_curse` or `both`. Leave it empty when the paper doesn't address either. |
| `is_near_miss` | `true` for a paper that looks relevant at first glance but isn't, `false` for everything else. |
| `split` | `dev` or `holdout` (see below). |

A few things make the set more useful:

- Use papers like the ones the pipeline will actually find, not only the well-known ones. The relevant papers in the team's Notion database are a good start.
- Include both kinds of relevant paper: arguments and milestone evidence.
- Near misses are the papers that teach us the most. Good ones are a routine motor decoding BCI study, a neuromorphic chip benchmark, an AI safety paper with no neurotechnology in it, and a paper where "alignment" means lining up signals.
- If you aren't sure how to label a paper, leave it out. A wrong label makes the AI look worse (or better) than it is.

Don't paste abstracts into the file. It holds ids and labels only, and the eval fetches the abstracts each time it runs without saving them, because journal abstracts are copyrighted.

## Dev and holdout

Put about a third of the rows in `holdout` and the rest in `dev`. When the prompt changes, judge the change on the dev results only. Look at holdout once you're happy with dev, as a final check. A prompt that only works on the papers it was tuned against will do noticeably worse on holdout.

## Running it

From the repo root, with the virtual environment active and `ANTHROPIC_API_KEY` set:

```
python -m sf_pipeline.eval --gold pipeline/eval/gold_v1.csv --reps 3
```

Each paper is triaged three times, because the model's answers vary a little between runs, and the 90% target has to hold on the worst of the three. A hundred papers at three reps is about 300 calls, which comes to roughly 20 cents with the default model. The eval stops if it reaches $2 (change that with `--max-cost-usd`). Add `--split dev` to skip the holdout papers, and `--out results.json` to save every answer (don't commit that file).

## Reading the report

The report starts with recall: the share of relevant papers the AI passed on, for dev and holdout. Below that are precision over the relevant papers and near misses, how often the AI's kind, technology and problem match your labels, and how often it refused or returned something unusable.

The most useful part is usually the list at the end of relevant papers the AI said no to. For each one, either the label needs another look or the prompt (`pipeline/sf_pipeline/prompts/triage_v1.md`) needs to explain that kind of paper better. If you change a label, add a note somewhere the team can see, so the gold set doesn't drift toward whatever the AI says.
