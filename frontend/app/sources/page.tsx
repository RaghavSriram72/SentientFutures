import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/common/PageHeader";
import { ALL_MARKS, MarksHelp } from "@/components/provenance/MarksHelp";
import { DirectionGlyph } from "@/components/sources/ClaimDirectionChip";
import { SourceDatabase } from "@/components/sources/SourceDatabase";
import { getSources } from "@/lib/data";
import { realSources, sortByRegisterId } from "@/lib/sources";
import type { Provenance, Source } from "@/lib/types";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Source database",
  description:
    "The sources the team has collected, each with the team's summary and tags for technology, problem and which way it argues.",
};

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

// The person who added most of the sources, or null when no one added most of
// them. A row only names who added it when it's someone else.
function mostCommonAdder(sources: Source[]): string | null {
  const counts = new Map<string, number>();
  for (const source of sources) {
    if (source.added_by) {
      counts.set(source.added_by, (counts.get(source.added_by) ?? 0) + 1);
    }
  }
  let name: string | null = null;
  let best = 0;
  for (const [adder, count] of counts) {
    if (count > best) {
      name = adder;
      best = count;
    }
  }
  // Only worth leaving off the rows if it covers most of the list.
  if (name === null || best * 2 <= sources.length) {
    return null;
  }
  return name;
}

// The sentence at the top: what's here and how much of it hasn't been rated
// yet. Its counts come from the data, so it stays true as the team rates and
// adds sources. "rated" links to the scales a rating uses.
function headerSentence(sources: Source[]): ReactNode {
  const total = sources.length;
  const unrated = countUnrated(sources);
  const count = `${total} ${total === 1 ? "source" : "sources"} the team has collected.`;

  // "None has", "It hasn't" (one source), "3 haven't", or "" when all are rated.
  let unratedSubject = "";
  if (unrated === total && total === 1) {
    unratedSubject = "It hasn't";
  } else if (unrated === total) {
    unratedSubject = "None has";
  } else if (unrated > 0) {
    unratedSubject = `${unrated} ${unrated === 1 ? "hasn't" : "haven't"}`;
  }
  if (unratedSubject === "") {
    return count;
  }
  return (
    <>
      {count} {unratedSubject} been <Link href="/methodology/#credibility">rated</Link> yet.
    </>
  );
}

// The marks the list actually shows, in the legend's order, so "How to read
// the marks" doesn't explain marks that appear nowhere on the page. A summary
// carries its own mark, and any field the AI suggested carries the AI mark.
function marksInList(sources: Source[]): Provenance[] {
  const shown = new Set<Provenance>();
  for (const source of sources) {
    shown.add(source.summary.provenance);
    if (source.ai_suggested_fields.length > 0) {
      shown.add("ai");
    }
  }
  const marks: Provenance[] = [];
  for (const kind of ALL_MARKS) {
    if (shown.has(kind)) {
      marks.push(kind);
    }
  }
  return marks;
}

export default function SourcesPage() {
  // The data folder only ever holds approved sources: the API export filters
  // out everything else, and content/sources.json is hand-checked. The
  // fictional samples stay in the file for the sample milestones that cite
  // them, but they aren't listed here.
  const sources = sortByRegisterId(realSources(getSources()));
  const sharedAddedBy = mostCommonAdder(sources);
  const noneRated = countUnrated(sources) === sources.length;

  return (
    <>
      <PageHeader
        compact
        eyebrow="Source database"
        title={
          <>
            What we&rsquo;ve <em>read</em> so far
          </>
        }
        lede={headerSentence(sources)}
      />

      <div className={`container ${styles.body}`}>
        {/* The marks disclosure sits beside the count, and the glyph key just
            above the list, so the first sources fit on the first screen. */}
        <SourceDatabase
          sources={sources}
          sharedAddedBy={sharedAddedBy}
          hideUnrated={noneRated}
          marks={<MarksHelp kinds={marksInList(sources)} />}
          directionKey={
            <p className={styles.helpNote}>
              <DirectionGlyph tone="for" label="A plus sign" /> means the source argues the approach could help, and{" "}
              <DirectionGlyph tone="against" label="a minus sign" /> that it won&rsquo;t help or could make things
              worse. <Link href="/methodology/#credibility">How we rate sources</Link>
            </p>
          }
        />
      </div>
    </>
  );
}
