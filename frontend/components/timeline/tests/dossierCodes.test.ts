// The links a timeline dossier makes in the workbook's evidence, timing and note cells.
// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "components/timeline/tests/*.test.ts"
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { splitCodes } from "@/lib/codes";
import type { SourceRef } from "@/lib/sources";
import type { Milestone } from "@/lib/types";

import { dossierCodeIndex } from "../dossierCodes";

function source(id: string, registerId: string | null, sample = false): SourceRef {
  return { id, register_id: registerId, title: `Title ${id}`, authors: ["Ada Lovelace"], year: 2024, url: "https://example.org", venue: null, sample };
}

const sources: Record<string, SourceRef> = {
  s13: source("s13", "S13"),
  s16: source("s16", "S16"),
  "sample-report": source("sample-report", "S99", true),
};

function milestone(evidenceEntries: string[] | undefined): Milestone {
  return { evidence_entries: evidenceEntries } as Milestone;
}

describe("dossierCodeIndex", () => {
  test("links the entries the milestone lists and the site's sources", () => {
    const index = dossierCodeIndex(milestone(["E037", "E043"]), sources);
    const parts = splitCodes("E037, E043, E065 (components demonstrated; S13 and S16)", index);
    const linked = parts.filter((part) => part.target).map((part) => [part.text, part.target?.href]);
    assert.deepEqual(linked, [
      ["E037", "/evidence/#e037"],
      ["E043", "/evidence/#e043"],
      ["S13", "/sources/#s13"],
      ["S16", "/sources/#s16"],
    ]);
    // The words never change.
    assert.equal(parts.map((part) => part.text).join(""), "E037, E043, E065 (components demonstrated; S13 and S16)");
  });

  test("leaves sample sources and unlisted entries plain", () => {
    const index = dossierCodeIndex(milestone(undefined), sources);
    assert.deepEqual(index.targets, {});
    assert.equal(index.sources.S99, undefined);
    assert.equal(index.sources.S13.title, "Lovelace 2024");
  });
});
