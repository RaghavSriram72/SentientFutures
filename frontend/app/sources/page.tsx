import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/common/PageHeader";
import { ProvenanceLegend } from "@/components/provenance/Legends";
import { DirectionGlyph } from "@/components/sources/ClaimDirectionChip";
import { SourceDatabase } from "@/components/sources/SourceDatabase";
import { getSources } from "@/lib/data";
import { RUBRIC_VERSION } from "@/lib/enums";
import { realSources, sortByRegisterId } from "@/lib/sources";
import type { Source } from "@/lib/types";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Source database",
  description:
    "The sources in the team's scouting database, each with the team's summary and tags for technology, problem and which way it argues.",
};

function countScouted(sources: Source[]): number {
  let count = 0;
  for (const source of sources) {
    if (source.register_id) {
      count += 1;
    }
  }
  return count;
}

// A source counts as unrated until at least one rubric field has a value.
function countUnrated(sources: Source[]): number {
  let count = 0;
  for (const source of sources) {
    const ratings = [source.evidence_type, source.directness, source.independence, source.relevance, source.credibility];
    let hasRating = false;
    for (const rating of ratings) {
      if (rating !== null && rating !== undefined) {
        hasRating = true;
      }
    }
    if (!hasRating) {
      count += 1;
    }
  }
  return count;
}

// The note under the key. Its counts come from the data, so it stays true as
// the team rates sources.
function scoutingNote(total: number, scouted: number, unrated: number): string {
  const parts: string[] = [];
  if (scouted === total) {
    parts.push(
      "These come from the team's scouting database, where each source is tagged by technology, problem and which way it argues.",
    );
  } else if (scouted > 0) {
    parts.push(
      `${scouted} of these come from the team's scouting database, where each source is tagged by technology, problem and which way it argues.`,
    );
  }
  const rubric = "evidence type, directness, independence, relevance and credibility";
  if (unrated === total) {
    parts.push(`None has been rated on the rubric yet: ${rubric}.`);
  } else if (unrated > 0) {
    parts.push(`${unrated} haven't been rated on the rubric yet: ${rubric}.`);
  }
  return parts.join(" ");
}

export default function SourcesPage() {
  // The data folder only ever holds approved sources: the API export filters
  // out everything else, and content/sources.json is hand-checked. The
  // fictional samples stay in the file for the sample milestones that cite
  // them, but they aren't listed here.
  const sources = sortByRegisterId(realSources(getSources()));
  const note = scoutingNote(sources.length, countScouted(sources), countUnrated(sources));

  return (
    <>
      <PageHeader
        eyebrow="Source database"
        title={
          <>
            What we&rsquo;ve <em>read</em> so far
          </>
        }
        lede="Each card has the team's summary of the source and its tags. The tags use the named categories defined on the methodology page."
      >
        <span className="chip">
          {sources.length} {sources.length === 1 ? "source" : "sources"}
        </span>
        <span className="chip">Rubric v{RUBRIC_VERSION}</span>
      </PageHeader>

      <div className={`container ${styles.body}`}>
        <aside className={styles.key} aria-label="How to read these cards">
          <div className={styles.keyMarks}>
            <p className="eyebrow">The marks</p>
            <ProvenanceLegend compact />
          </div>
          <p className={styles.keyNote}>
            Categories marked <span className={styles.draftWord}>draft</span> are still being decided. A dashed chip
            means an AI suggested that value and a person checked it. Under Claim direction,{" "}
            <DirectionGlyph tone="for" label="a plus sign" /> means the source argues the approach could help, and{" "}
            <DirectionGlyph tone="against" label="a minus sign" /> means it argues the approach won&rsquo;t help or
            could make things worse. <Link href="/methodology/#credibility">How we rate sources</Link>
          </p>
        </aside>

        {note !== "" && <p className={styles.scoutNote}>{note}</p>}

        <SourceDatabase sources={sources} />
      </div>
    </>
  );
}
