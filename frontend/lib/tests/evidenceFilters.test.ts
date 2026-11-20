// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "lib/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  ALL,
  CROSS_FAMILY,
  NOT_USED,
  NO_EVIDENCE_SEARCH,
  SCENARIO_WILDCARD_CODE,
  activeFilters,
  citationRepeatsTitle,
  countActiveFilters,
  entryByline,
  entryDefinitions,
  evidenceRows,
  familyOptions,
  feedLabel,
  feedOptions,
  fold,
  hasAtWordStart,
  isShown,
  matchesFamily,
  matchesFeeds,
  matchesFilters,
  optionsWithCounts,
  outcomeText,
  readSearch,
  roleOptions,
  searchQueryString,
  searchText,
  sourceOptions,
  splitQuery,
  type EvidenceOptions,
  type EvidenceRowData,
} from "@/lib/evidenceFilters";
import type { SourceRef } from "@/lib/sources";
import type { CodebookRow, EvidenceEntry, MilestoneCategoryInfo, ScorecardData, Source } from "@/lib/types";
import { feedKeys } from "@/lib/workbook";

function entry(id: string, overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    id,
    source_id: "s01",
    register_id: "S01",
    locator: "Fixture locator",
    claim: `Claim ${id}.`,
    codes: [],
    family: "bci",
    feeds: [],
    feeds_text: "Not used in a headline rating",
    source_type_independence: "Presentation; Unknown",
    outcome: "AI Alignment",
    alignment_problem: "N/A",
    scenarios: [],
    stage: "N/A",
    directness: "direct",
    role: "supports",
    basis: "argued",
    ...overrides,
  };
}

const CATEGORIES: MilestoneCategoryInfo[] = [
  { id: "M1", category: "technical_capability", label: "Technical capability", question: "" },
  { id: "M2", category: "high_level_fidelity", label: "High-level fidelity", question: "" },
  { id: "M6", category: "economic_viability", label: "Economic viability", question: "" },
];

const CODEBOOK: CodebookRow[] = [
  { type: "Scenario", code: "WBE-O", family: "WBE", definition: "AI overseer" },
  { type: "Scenario", code: "BCI-D", family: "BCI", definition: "Neural data for alignment" },
  { type: "Stage", code: "S1", family: "WBE", definition: "Neural component simulation" },
  { type: "Stage", code: "S1", family: "BCI", definition: "Read-only / passive decoding" },
  { type: "Alignment problem", code: "A-VS", family: "All", definition: "Value specification" },
  { type: "Directness", code: "Direct (family itself)", family: "All", definition: "Source studies the family itself" },
];

function scorecardWith(entries: EvidenceEntry[]): ScorecardData {
  return {
    generated: "test",
    workbook: { title: "Test", version: "0.4", source_sha256: "0" },
    codebook: CODEBOOK,
    milestone_categories: CATEGORIES,
    entries,
  } as ScorecardData;
}

const SOURCE: SourceRef = {
  id: "s01",
  register_id: "S01",
  title: "Brain-Computer Interfaces for AI Alignment",
  authors: ["Lisa Thiergart"],
  year: 2023,
  url: "https://example.org",
  venue: null,
};

function row(item: EvidenceEntry, definitions: Record<string, string> = {}): EvidenceRowData {
  return { entry: item, source: item.source_id === "s01" ? SOURCE : null, definitions };
}

describe("family filter", () => {
  test("offers the register's own family words, Cross-family last", () => {
    assert.deepEqual(
      familyOptions().map((option) => option.label),
      ["WBE", "BCI", "Neuromorphic AI", "Cross-family"],
    );
    assert.equal(familyOptions()[3].value, CROSS_FAMILY);
  });

  test("matches the Family cell or a family named in Ratings it informs", () => {
    const own = entry("E001", { family: "wbe" });
    // Like E042: Cross-family, but it feeds a Neuromorphic AI rating.
    const fed = entry("E042", {
      family: "cross_family",
      feeds: [{ family: "neuromorphic", target: "alignment", direction: "supports", note: null }],
    });
    assert.equal(matchesFamily(own, "wbe"), true);
    assert.equal(matchesFamily(own, "bci"), false);
    assert.equal(matchesFamily(fed, "neuromorphic"), true);
    assert.equal(matchesFamily(fed, "wbe"), false);
  });

  test("Cross-family picks only entries whose Family cell says so", () => {
    assert.equal(matchesFamily(entry("E042", { family: "cross_family" }), CROSS_FAMILY), true);
    assert.equal(matchesFamily(entry("E001", { family: "bci" }), CROSS_FAMILY), false);
  });
});

describe("ratings it informs filter", () => {
  const entries = [
    entry("E001", { feeds: [{ family: "bci", target: "M6", direction: "against_or_qualifies", note: null }] }),
    entry("E002", {
      feeds: [
        {
          family: "neuromorphic",
          target: "intelligence_curse",
          direction: "supports",
          note: "efficiency prerequisite only",
        },
        { family: "neuromorphic", target: "M6", direction: "supports", note: null },
      ],
    }),
    entry("E003", { feeds: [{ family: "bci", target: "alignment", direction: "supports", note: null }] }),
    entry("E004", { feeds: [{ family: "wbe", target: "M1", direction: "supports", note: null }] }),
    entry("E005"),
  ];

  test("lists the ratings some entry feeds, by family, then Not used in a headline rating", () => {
    const options = feedOptions(entries, CATEGORIES);
    assert.deepEqual(
      options.map((option) => option.value),
      ["wbe-m1", "bci-alignment", "bci-m6", "neuromorphic-intelligence-curse", "neuromorphic-m6", NOT_USED],
    );
    assert.deepEqual(
      options.map((option) => option.label),
      [
        "WBE M1 Technical capability",
        "BCI Alignment",
        "BCI M6 Economic viability",
        "Neuromorphic AI Intelligence Curse",
        "Neuromorphic AI M6 Economic viability",
        "Not used in a headline rating",
      ],
    );
  });

  test("leaves out Not used when every entry feeds something", () => {
    const options = feedOptions(entries.slice(0, 4), CATEGORIES);
    assert.equal(
      options.some((option) => option.value === NOT_USED),
      false,
    );
  });

  test("matches a feed key, and none for entries that feed nothing", () => {
    assert.equal(matchesFeeds(entries[1], "neuromorphic-m6"), true);
    assert.equal(matchesFeeds(entries[1], "bci-m6"), false);
    assert.equal(matchesFeeds(entries[4], NOT_USED), true);
    assert.equal(matchesFeeds(entries[0], NOT_USED), false);
  });

  test("names a milestone without a known category by its code alone", () => {
    assert.equal(feedLabel("bci", "M9", CATEGORIES), "BCI M9");
  });
});

describe("Codebook definitions", () => {
  test("a stage uses the entry's own family", () => {
    const scorecard = scorecardWith([]);
    assert.equal(
      entryDefinitions(scorecard, entry("E001", { family: "wbe", stage: "S1" }))["S1"],
      "Neural component simulation",
    );
    assert.equal(
      entryDefinitions(scorecard, entry("E002", { family: "bci", stage: "S1" }))["S1"],
      "Read-only / passive decoding",
    );
  });

  test("a Cross-family entry's stage stays a bare code", () => {
    const definitions = entryDefinitions(scorecardWith([]), entry("E042", { family: "cross_family", stage: "S1" }));
    assert.equal(definitions["S1"], undefined);
  });

  test("a scenario code finds its family from its prefix, so a Cross-family entry still gets it", () => {
    const definitions = entryDefinitions(
      scorecardWith([]),
      entry("E109", { family: "cross_family", scenarios: ["BCI-D", "WBE-C"] }),
    );
    assert.equal(definitions["BCI-D"], "Neural data for alignment");
    // No row of its own and no wildcard row in this Codebook, so no
    // definition is made up.
    assert.equal(definitions["WBE-C"], undefined);
  });

  test("a scenario code ending -X, -C or -U takes the wildcard row's meaning, unless it has its own row", () => {
    const scorecard = {
      ...scorecardWith([]),
      codebook: [
        ...CODEBOOK,
        {
          type: "Scenario",
          code: SCENARIO_WILDCARD_CODE,
          family: "All",
          definition: "Other (specify) / cross-cutting (list scenarios covered) / unspecified",
        },
        { type: "Scenario", code: "BCI-X", family: "BCI", definition: "Other (specify), used for S01" },
      ],
    } as ScorecardData;
    const definitions = entryDefinitions(
      scorecard,
      entry("E001", { family: "wbe", scenarios: ["WBE-C", "BCI-U", "NM-X", "BCI-X", "WBE-O", "WBE-Q"] }),
    );
    assert.equal(definitions["WBE-C"], "Cross-cutting");
    assert.equal(definitions["BCI-U"], "Unspecified");
    assert.equal(definitions["NM-X"], "Other");
    assert.equal(definitions["BCI-X"], "Other (specify), used for S01");
    assert.equal(definitions["WBE-O"], "AI overseer");
    assert.equal(definitions["WBE-Q"], undefined);
  });

  test("the alignment problem and directness come from the Codebook, N/A from nowhere", () => {
    const withProblem = entryDefinitions(scorecardWith([]), entry("E001", { alignment_problem: "A-VS" }));
    assert.equal(withProblem["A-VS"], "Value specification");
    assert.equal(withProblem["Direct (family itself)"], "Source studies the family itself");
    const without = entryDefinitions(scorecardWith([]), entry("E002", { alignment_problem: "N/A" }));
    assert.equal(without["N/A"], undefined);
  });

  test("evidenceRows keeps register order and finds each entry's source", () => {
    const rows = evidenceRows(scorecardWith([entry("E002"), entry("E001", { source_id: "s99" })]), { s01: SOURCE });
    assert.deepEqual(
      rows.map((item) => item.entry.id),
      ["E002", "E001"],
    );
    assert.equal(rows[0].source?.id, "s01");
    assert.equal(rows[1].source, null);
  });
});

describe("the row's byline", () => {
  test("is the source, the family word and column G word for word", () => {
    const item = entry("E037", {
      register_id: "S13",
      family: "wbe",
      feeds_text: "WBE Alignment (against or qualifies)",
    });
    assert.equal(entryByline(item), "S13 · WBE · WBE Alignment (against or qualifies)");
    assert.equal(
      entryByline(entry("E042", { register_id: "S13", family: "cross_family" })),
      "S13 · Cross-family · Not used in a headline rating",
    );
  });
});

describe("the outcome a row shows", () => {
  test("uses the site's wording, and Both names the two outcomes", () => {
    assert.equal(outcomeText(entry("E001", { outcome: "AI Alignment" })), "AI alignment");
    assert.equal(outcomeText(entry("E002", { outcome: "Intelligence Curse" })), "Intelligence Curse");
    assert.equal(outcomeText(entry("E003", { outcome: "Both" })), "AI alignment · Intelligence Curse");
    assert.equal(outcomeText(entry("E004", { outcome: "Neither" })), "Neither");
  });

  test("the search finds an entry by the outcome it shows", () => {
    const text = searchText(row(entry("E003", { outcome: "Both" })));
    assert.ok(hasAtWordStart(text, "intelligence"));
    assert.ok(hasAtWordStart(text, "alignment"));
  });
});

describe("the search", () => {
  test("folds accents and hyphens and matches at word starts", () => {
    assert.equal(fold("Closed-loop Fidêncio"), "closed loop fidencio");
    assert.deepEqual(splitQuery("  A-VS  overseer "), ["a", "vs", "overseer"]);
    assert.equal(hasAtWordStart("ai misalignment", "align"), false);
    assert.equal(hasAtWordStart("ai alignment", "align"), true);
  });

  test("finds an entry by its number, its source, a code or a Codebook definition", () => {
    const item = row(entry("E042", { codes: ["WBE-M5"], scenarios: ["WBE-O"] }), { "WBE-O": "AI overseer" });
    const text = searchText(item);
    for (const word of ["042", "e042", "s01", "thiergart", "wbe m5", "overseer"]) {
      assert.ok(
        splitQuery(word).every((part) => hasAtWordStart(text, part)),
        word,
      );
    }
  });
});

describe("filtering and counting", () => {
  const rows = [
    row(entry("E001", { family: "wbe", role: "supports" })),
    row(entry("E002", { family: "bci", role: "contrary" })),
    row(entry("E003", { family: "bci", role: "supports", source_id: "s02", register_id: "S02" })),
  ];

  test("every select and the search have to agree", () => {
    const search = { ...NO_EVIDENCE_SEARCH, family: "bci", role: "supports" };
    assert.deepEqual(
      rows.filter((item) => isShown(item, search)).map((item) => item.entry.id),
      ["E003"],
    );
    assert.equal(isShown(rows[0], { ...NO_EVIDENCE_SEARCH, query: "E001" }), true);
    assert.equal(isShown(rows[0], { ...NO_EVIDENCE_SEARCH, query: "E002" }), false);
  });

  test("skip leaves one select out, for that select's own counts", () => {
    const search = { ...NO_EVIDENCE_SEARCH, family: "wbe", role: "contrary" };
    assert.equal(matchesFilters(rows[1].entry, search, "family"), true);
    assert.equal(matchesFilters(rows[1].entry, search, null), false);
  });

  test("an option nothing would show is disabled, unless it's the one picked", () => {
    const context = rows.filter((item) => item.entry.family === "wbe");
    const options = optionsWithCounts(context, "role", roleOptions(), "contrary");
    const supports = options.find((option) => option.value === "supports");
    const contrary = options.find((option) => option.value === "contrary");
    const qualifies = options.find((option) => option.value === "qualifies");
    assert.equal(supports?.count, 1);
    assert.equal(contrary?.disabled, false);
    assert.equal(qualifies?.disabled, true);
  });

  test("counts the selects that are filtering", () => {
    assert.equal(countActiveFilters(NO_EVIDENCE_SEARCH), 0);
    assert.equal(countActiveFilters({ ...NO_EVIDENCE_SEARCH, query: "scan", family: "wbe", source: "s01" }), 2);
  });

  test("a source cited by its title is told apart from one cited by author or venue", () => {
    const base: SourceRef = { id: "s25", register_id: "S25", title: "A title", authors: [], year: 2018, url: "", venue: null };
    assert.equal(citationRepeatsTitle(base), true);
    assert.equal(citationRepeatsTitle({ ...base, venue: "LessWrong" }), false);
    assert.equal(citationRepeatsTitle({ ...base, authors: ["Ada Lovelace"] }), false);
  });

  test("source options are in register order with the short citation", () => {
    const options = sourceOptions([rows[2], rows[0]]);
    assert.deepEqual(
      options.map((option) => option.value),
      ["s01", "s02"],
    );
    assert.equal(options[0].label, "S01 · Thiergart 2023");
    // The site doesn't have s02 in this fixture, so only its register id.
    assert.equal(options[1].label, "S02");
  });
});

describe("the address", () => {
  const options: EvidenceOptions = {
    family: familyOptions(),
    feeds: [
      { value: "bci-alignment", label: "BCI Alignment" },
      { value: "bci-intelligence-curse", label: "BCI Intelligence Curse" },
      { value: NOT_USED, label: "Not used in a headline rating" },
    ],
    role: roleOptions(),
    source: [{ value: "s13", label: "S13" }],
  };

  test("reads each filter, forgiving case and underscores", () => {
    const search = readSearch(
      new URLSearchParams("family=cross_family&feeds=BCI-Intelligence_Curse&role=supports&source=S13&q=scan"),
      options,
    );
    assert.deepEqual(search, {
      query: "scan",
      family: CROSS_FAMILY,
      feeds: "bci-intelligence-curse",
      role: "supports",
      source: "s13",
    });
  });

  test("an unknown value falls back to all", () => {
    const search = readSearch(new URLSearchParams("family=hybrid&feeds=wbe-m3&source=s99"), options);
    assert.equal(search.family, ALL);
    assert.equal(search.feeds, ALL);
    assert.equal(search.source, ALL);
  });

  test("names the filters in use with the picked option's label", () => {
    assert.deepEqual(activeFilters(NO_EVIDENCE_SEARCH, options), []);
    const search = { ...NO_EVIDENCE_SEARCH, query: "scan", feeds: "bci-alignment", source: "s13" };
    assert.deepEqual(activeFilters(search, options), [
      { name: "feeds", label: "BCI Alignment" },
      { name: "source", label: "S13" },
    ]);
  });

  test("writes only what is filtering, and reads back the same", () => {
    assert.equal(searchQueryString(NO_EVIDENCE_SEARCH), "");
    const search = { ...NO_EVIDENCE_SEARCH, query: "scan", family: "bci", feeds: NOT_USED };
    const written = searchQueryString(search);
    assert.equal(written, "q=scan&family=bci&feeds=none");
    assert.deepEqual(readSearch(new URLSearchParams(written), options), search);
  });
});

// The real register, so the filters are checked against Vilija's own text.
describe("content/scorecard.json", () => {
  function readContent<T>(fileName: string): T {
    const url = new URL(`../../../content/${fileName}`, import.meta.url);
    return JSON.parse(readFileSync(url, "utf8")) as T;
  }
  const scorecard = readContent<ScorecardData>("scorecard.json");
  const sources = readContent<Source[]>("sources.json");
  const refs: Record<string, SourceRef> = {};
  for (const source of sources) {
    refs[source.id] = {
      id: source.id,
      register_id: source.register_id ?? null,
      title: source.title,
      authors: source.authors,
      year: source.year,
      url: source.url,
      venue: source.venue ?? null,
    };
  }
  const entries = scorecard.entries ?? [];
  const rows = evidenceRows(scorecard, refs);
  const feeds = feedOptions(entries, scorecard.milestone_categories ?? []);

  test("every entry has a row and a source on the site", () => {
    assert.equal(rows.length, entries.length);
    for (const item of rows) {
      assert.ok(item.source, `${item.entry.id} cites ${item.entry.register_id}, which the site doesn't have`);
    }
  });

  test("each rating option is in column G's own words", () => {
    for (const item of entries) {
      for (const key of feedKeys(item)) {
        const option = feeds.find((candidate) => candidate.value === key);
        assert.ok(option, `${item.id}: no option for ${key}`);
        assert.ok(item.feeds_text.includes(option.label), `${item.id}: "${option.label}" not in "${item.feeds_text}"`);
      }
    }
  });

  test("each entry is under at least one family, and the families add up", () => {
    const families = familyOptions();
    for (const item of entries) {
      assert.ok(
        families.some((option) => matchesFamily(item, option.value)),
        item.id,
      );
    }
    const crossFamily = entries.filter((item) => matchesFamily(item, CROSS_FAMILY));
    assert.equal(crossFamily.length, entries.filter((item) => item.family === "cross_family").length);
  });

  test("Not used in a headline rating matches exactly the entries column G says it of", () => {
    for (const item of entries) {
      assert.equal(matchesFeeds(item, NOT_USED), item.feeds_text === "Not used in a headline rating", item.id);
    }
  });

  test("every scenario code with a Codebook definition shows it", () => {
    const hasWildcard = (scorecard.codebook ?? []).some(
      (codebookRow) => codebookRow.type === "Scenario" && codebookRow.code === SCENARIO_WILDCARD_CODE,
    );
    for (const item of rows) {
      for (const code of item.entry.scenarios ?? []) {
        // Its own row, or the wildcard row for a code ending -X, -C or -U.
        const defined =
          (scorecard.codebook ?? []).some(
            (codebookRow) => codebookRow.type === "Scenario" && codebookRow.code === code,
          ) ||
          (hasWildcard && /-[XCU]$/.test(code));
        assert.equal(Boolean(item.definitions[code]), defined, `${item.entry.id} ${code}`);
      }
    }
  });

  test("the real Codebook's wildcard row defines WBE-C and BCI-U, and BCI-X keeps its own row", () => {
    const byCode: Record<string, string> = {};
    for (const item of rows) {
      for (const code of item.entry.scenarios ?? []) {
        byCode[code] = item.definitions[code];
      }
    }
    assert.equal(byCode["WBE-C"], "Cross-cutting");
    assert.equal(byCode["BCI-U"], "Unspecified");
    assert.ok(byCode["BCI-X"] && byCode["BCI-X"] !== "Other", byCode["BCI-X"]);
  });
});
