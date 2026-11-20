// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "lib/tests/*.test.ts"
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CODE_PATTERNS,
  buildCodeIndex,
  entryHref,
  familyOfCode,
  findCodes,
  governanceHref,
  idsIn,
  linkHref,
  milestoneAnchor,
  milestoneHref,
  milestoneParts,
  pathwayHref,
  registerIdsIn,
  resolveCode,
  riskHref,
  splitCodes,
  type CodeKind,
} from "@/lib/codes";
import type { SourceRef } from "@/lib/sources";
import type { ScorecardData } from "@/lib/types";

import fixture from "./fixtures/workbook-codes.json";

// The workbook's own id lists, from the fixture.
const KNOWN: Record<string, string[]> = fixture.known;

function codesOf(text: string, kind: CodeKind): string[] {
  return findCodes(text)
    .filter((found) => found.kind === kind)
    .map((found) => found.code);
}

describe("the patterns over every workbook string", () => {
  const allowed: Record<CodeKind, string[]> = {
    source: KNOWN.sources,
    entry: KNOWN.entries,
    link: KNOWN.links,
    risk: KNOWN.risks,
    governance: KNOWN.governance,
    milestone: KNOWN.milestones,
    scenario: KNOWN.scenarios,
  };

  test("the fixture has the workbook's ids", () => {
    assert.equal(KNOWN.sources.length, 30);
    assert.equal(KNOWN.entries.length, 121);
    assert.equal(KNOWN.links.length, 75);
    assert.equal(KNOWN.risks.length, 22);
    assert.equal(KNOWN.governance.length, 27);
    assert.ok(fixture.strings.length > 500);
  });

  for (const kind of Object.keys(allowed) as CodeKind[]) {
    test(`every ${kind} code found is one the workbook defines`, () => {
      const strays: string[] = [];
      for (const text of fixture.strings) {
        for (const code of codesOf(text, kind)) {
          if (!allowed[kind].includes(code)) {
            strays.push(`${code} in "${text.slice(0, 80)}"`);
          }
        }
      }
      assert.deepEqual(strays, []);
    });
  }

  test("every code in the register's id column is found whole", () => {
    // Column E holds link, milestone, risk and checklist ids, plus words that aren't ids.
    const notIds = ["AM", "IC comparator (D05)", "Comparator (Alignment)"];
    assert.ok(KNOWN.register_codes.length > 50);
    for (const cell of KNOWN.register_codes) {
      for (const token of cell.split("; ")) {
        if (notIds.includes(token)) {
          assert.deepEqual(findCodes(token), [], token);
          continue;
        }
        const found = findCodes(token);
        assert.equal(found.length, 1, `${token} in "${cell}"`);
        assert.equal(found[0].code, token);
      }
    }
  });

  test("every pattern is global, for matchAll", () => {
    for (const pattern of Object.values(CODE_PATTERNS)) {
      assert.ok(pattern.global);
    }
  });
});

describe("stages are not sources", () => {
  const scope =
    "Whole brain emulation: scanning a specific human brain at sufficient resolution and running a computational " +
    "model that reproduces that person's cognition (stages S1 component simulation → S6 deployed populations). " +
    "Systems that model only parts of a brain are not treated as WBE (e.g., partial emulation and digital twins (S1-S2)).";

  test("S1, S6 and S1-S2 in the Scope tab are stages", () => {
    assert.deepEqual(findCodes(scope), []);
    assert.deepEqual(registerIdsIn(scope), []);
  });

  test("No source dates S3", () => {
    const text = "Long (> 15 y). No source dates S3; S13: whole-brain simulation 'many years out'; S21: de novo AI plausibly first.";
    assert.deepEqual(codesOf(text, "source"), ["S13", "S21"]);
  });
});

describe("ranges", () => {
  const harms = "Suffering across copies; labour displacement; political dominance of digital minds (R01-R06, R20, R21)";

  test("each end of a range is found, and marked as a range end", () => {
    const found = findCodes("displacement argued (S20-S22). → Both");
    assert.deepEqual(
      found.map((item) => [item.code, item.inRange]),
      [
        ["S20", true],
        ["S22", true],
      ],
    );
  });

  test("an id list takes every id in a range", () => {
    assert.deepEqual(registerIdsIn("S01, S08, S09, S10, S11, S14, S16, S18, S19, S24-S29"), [
      "S01", "S08", "S09", "S10", "S11", "S14", "S16", "S18", "S19", "S24", "S25", "S26", "S27", "S28", "S29",
    ]);
    assert.deepEqual(idsIn(harms, "risk"), ["R01", "R02", "R03", "R04", "R05", "R06", "R20", "R21"]);
    assert.deepEqual(registerIdsIn("argued by preprints (S05-S07) and one peer-reviewed argument (S30)"), [
      "S05", "S06", "S07", "S30",
    ]);
  });

  test("each id comes once, in text order", () => {
    assert.deepEqual(registerIdsIn("S13 and S16; then S13 again (S12-S14)"), ["S13", "S16", "S12", "S14"]);
  });

  test("a stage range and a mixed pair are not ranges", () => {
    assert.deepEqual(registerIdsIn("(S1-S2) and S05-R07"), ["S05"]);
  });
});

describe("codes that look alike", () => {
  test("a link id is one code, not a scenario", () => {
    assert.deepEqual(
      findCodes("No entry addresses supervising a more capable system (WBE-O-L4) or compares (WBE-O-L5).").map(
        (item) => [item.kind, item.code],
      ),
      [
        ["link", "WBE-O-L4"],
        ["link", "WBE-O-L5"],
      ],
    );
  });

  test("milestone codes keep their family", () => {
    assert.deepEqual(codesOf("BCI-M1; BCI-T-L1", "milestone"), ["BCI-M1"]);
    assert.deepEqual(codesOf("NM-M6; NM-E-L1", "link"), ["NM-E-L1"]);
    assert.deepEqual(codesOf("BCI-M1", "scenario"), []);
  });

  test("slash shorthands are left alone", () => {
    assert.deepEqual(findCodes("humanity at large via aligned intelligence (WBE-O/R/G)"), []);
    assert.deepEqual(findCodes("disempowerment pathways (BCI-W/S/P)"), []);
    assert.deepEqual(findCodes("Medium-Long for BCI-D/O/E"), []);
  });

  test("scenario codes in prose are found", () => {
    assert.deepEqual(codesOf("Near for BCI-T, BCI-W, BCI-P (devices in trials)", "scenario"), ["BCI-T", "BCI-W", "BCI-P"]);
    assert.deepEqual(codesOf("(NM-E decentralisation unclaimed). → Alignment", "scenario"), ["NM-E"]);
  });

  test("words that aren't codes stay text", () => {
    for (const text of ["AM", "IC comparator (D05)", "Comparator (Alignment)", "A-VS", "N/A", "RF1", "GPT-4", "*-C / *-U codes"]) {
      assert.deepEqual(findCodes(text), [], text);
    }
  });

  test("the family of a code comes from its prefix", () => {
    assert.equal(familyOfCode("WBE-O-L1"), "wbe");
    assert.equal(familyOfCode("BCI-M6"), "bci");
    assert.equal(familyOfCode("NM-A"), "neuromorphic");
    assert.equal(familyOfCode("R01"), null);
  });
});

describe("where codes point", () => {
  test("the hrefs and anchors", () => {
    assert.equal(entryHref("E037"), "/evidence/#e037");
    assert.equal(linkHref("NM-A-L2"), "/neuromorphic/#link-nm-a-l2");
    assert.equal(pathwayHref("WBE-O"), "/wbe/#pathway-wbe-o");
    assert.equal(riskHref("R05", "bci"), "/bci/#risk-r05");
    assert.equal(governanceHref("G15", "bci"), "/bci/#governance-g15");
    assert.equal(milestoneHref("bci", "M1", 1), "/bci/#milestone-bci-m1-1");
    assert.equal(milestoneAnchor("wbe", "M7"), "milestone-wbe-m7");
  });

  test("a split milestone row is numbered among its family's rows", () => {
    const rows = [
      { family: "wbe" as const, milestone: "M1" },
      { family: "bci" as const, milestone: "M1" },
      { family: "bci" as const, milestone: "M1" },
      { family: "bci" as const, milestone: "M2" },
    ];
    assert.deepEqual(milestoneParts(rows), [null, 1, 2, null]);
  });
});

function source(id: string, registerId: string, authors: string[], year: number): SourceRef {
  return { id, register_id: registerId, title: `Title ${id}`, authors, year, url: `https://example.org/${id}`, venue: null };
}

const SCORECARD = {
  generated: "Fixture.",
  workbook: { title: "Fixture", version: "0.4" },
  entries: [{ id: "E037" }, { id: "E043" }],
  links: [
    { id: "WBE-O-L1", family: "wbe", scenario_code: "WBE-O" },
    { id: "NM-A-L2", family: "neuromorphic", scenario_code: "NM-A" },
  ],
  risks: [
    { id: "R01", families: ["wbe"] },
    { id: "R05", families: ["wbe", "neuromorphic", "bci"] },
  ],
  governance: [{ id: "G15", family: "bci" }],
  milestone_assessments: [
    { family: "bci", milestone: "M1" },
    { family: "bci", milestone: "M1" },
    { family: "wbe", milestone: "M8" },
  ],
} as unknown as ScorecardData;

const SOURCES = [
  source("s13", "S13", ["Patrick Mineault", "Niccolò Zanichelli", "Joanne Peng"], 2024),
  source("s20", "S20", ["Robin Hanson"], 2016),
  source("s22", "S22", ["Carl Shulman", "Nick Bostrom"], 2021),
  { ...source("sample-x", "S99", ["Nobody"], 2025), sample: true },
];

describe("the index of codes that exist", () => {
  const index = buildCodeIndex(SCORECARD, SOURCES);

  test("defined codes have targets", () => {
    assert.equal(index.targets.E037.href, "/evidence/#e037");
    assert.equal(index.targets["WBE-O-L1"].href, "/wbe/#link-wbe-o-l1");
    assert.equal(index.targets["WBE-O"].href, "/wbe/#pathway-wbe-o");
    assert.equal(index.targets.G15.href, "/bci/#governance-g15");
    // "BCI-M1" goes to the first of BCI's two M1 rows.
    assert.equal(index.targets["BCI-M1"].href, "/bci/#milestone-bci-m1-1");
    assert.equal(index.targets["WBE-M8"].href, "/wbe/#milestone-wbe-m8");
    assert.equal(index.sources.S13.href, "/sources/#s13");
    assert.equal(index.sources.S13.title, "Mineault et al. 2024");
    assert.equal(index.sources.S99, undefined);
  });

  test("a risk links to the page it is on when it belongs there, else its first family", () => {
    const r05 = findCodes("R05")[0];
    assert.equal(resolveCode(r05, index, "bci")?.href, "/bci/#risk-r05");
    const r01 = findCodes("R01")[0];
    assert.equal(resolveCode(r01, index, "bci")?.href, "/wbe/#risk-r01");
    assert.equal(resolveCode(r01, index)?.href, "/wbe/#risk-r01");
  });

  test("splitting keeps the text exactly and links only what exists", () => {
    const texts = [
      "Value inheritance argued (S16) and disputed (S13); drift raised (S20-S22); see E037, E999 and WBE-C.",
      "E072 (projected); E004 not admissible",
      "Main harms (R01-R06, R20, R21) and G15, BCI-M1, NM-A-L2, WBE-O/R/G.",
      "",
    ];
    for (const text of texts) {
      const parts = splitCodes(text, index, "wbe");
      assert.equal(parts.map((part) => part.text).join(""), text);
    }
    const linked = splitCodes(texts[0], index, "wbe")
      .filter((part) => part.target)
      .map((part) => part.text);
    // S16 and E999 aren't in the index, WBE-C has no pathway: all stay text.
    assert.deepEqual(linked, ["S13", "S20", "S22", "E037"]);
    const harms = splitCodes(texts[2], index, "wbe")
      .filter((part) => part.target)
      .map((part) => [part.text, part.target?.href]);
    // R06, R20 and R21 aren't in this index; the range's first end still links.
    assert.deepEqual(harms, [
      ["R01", "/wbe/#risk-r01"],
      ["G15", "/bci/#governance-g15"],
      ["BCI-M1", "/bci/#milestone-bci-m1-1"],
      ["NM-A-L2", "/neuromorphic/#link-nm-a-l2"],
    ]);
  });
});
