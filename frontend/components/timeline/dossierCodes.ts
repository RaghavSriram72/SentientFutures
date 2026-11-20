// Links for the workbook codes in a timeline dossier ("E037", "S13"), for when
// the page doesn't hand the dossier the full index from buildCodeIndex. It is
// built from the milestone itself, so it links only what certainly exists: an
// entry id that the milestone's evidence_entries lists, and a source id whose
// source is on the site (the same rule as buildCodeIndex). Anything else stays
// plain text.
import { entryHref, sourceHref, type CodeIndex, type CodeTarget } from "@/lib/codes";
import { shortCitation, type SourceRef } from "@/lib/sources";
import type { Milestone } from "@/lib/types";

export function dossierCodeIndex(milestone: Milestone, sources: Record<string, SourceRef>): CodeIndex {
  const targets: Record<string, CodeTarget> = {};
  for (const id of milestone.evidence_entries ?? []) {
    targets[id] = { href: entryHref(id) };
  }
  const sourceTargets: Record<string, CodeTarget> = {};
  for (const source of Object.values(sources)) {
    if (source.register_id && !source.sample) {
      sourceTargets[source.register_id] = { href: sourceHref(source.id), title: shortCitation(source) };
    }
  }
  return { targets, riskFamilies: {}, sources: sourceTargets };
}
