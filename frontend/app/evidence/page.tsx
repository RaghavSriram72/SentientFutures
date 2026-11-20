import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/common/PageHeader";
import { CrossFamilyNote } from "@/components/evidence/CrossFamilyNote";
import { EvidenceDatabase } from "@/components/evidence/EvidenceDatabase";
import { buildCodeIndex } from "@/lib/codes";
import { getScorecard, getSources } from "@/lib/data";
import {
  evidenceRows,
  familyOptions,
  feedOptions,
  roleOptions,
  sourceOptions,
  type EvidenceOptions,
} from "@/lib/evidenceFilters";
import { realSources, sourceRefsById, toSourceRef } from "@/lib/sources";

import styles from "./page.module.css";

// "Evidence register" is the workbook's own name for the tab.
export const metadata: Metadata = {
  title: "Evidence register",
  description: "Each claim the team took from a source, with the codes it is filed under and the ratings it informs.",
};

export default function EvidencePage() {
  const scorecard = getScorecard();
  // The fictional sample sources are never cited by the register.
  const sources = realSources(getSources());
  const sourceRefs = sourceRefsById(sources);
  const index = buildCodeIndex(scorecard, sources.map(toSourceRef));
  const rows = evidenceRows(scorecard, sourceRefs);
  const options: EvidenceOptions = {
    family: familyOptions(),
    feeds: feedOptions(scorecard.entries ?? [], scorecard.milestone_categories ?? []),
    role: roleOptions(),
    source: sourceOptions(rows),
  };
  const scope = scorecard.cross_family_scope ?? null;
  const total = rows.length;

  return (
    <>
      <PageHeader
        compact
        eyebrow="Evidence register"
        title={
          <>
            What the sources <em>claim</em>
          </>
        }
        lede={
          <>
            {total} {total === 1 ? "claim" : "claims"} from the <Link href="/sources/">sources</Link>, and where the
            scorecard uses {total === 1 ? "it" : "each one"}.
          </>
        }
      />

      <div className={`container ${styles.body}`}>
        <EvidenceDatabase
          rows={rows}
          index={index}
          options={options}
          crossFamilyNote={scope && <CrossFamilyNote scope={scope} sources={sourceRefs} index={index} />}
        />
      </div>
    </>
  );
}
