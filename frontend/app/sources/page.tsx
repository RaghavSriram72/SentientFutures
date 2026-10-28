import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/common/PageHeader";
import { MarksHelp } from "@/components/provenance/MarksHelp";
import { DirectionGlyph } from "@/components/sources/ClaimDirectionChip";
import { SourceDatabase } from "@/components/sources/SourceDatabase";
import { getSources } from "@/lib/data";
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

// The person who added most of the sources, and whether that's all of them.
// The header says it once, and a row only names who added it when it's someone else.
function mostCommonAdder(sources: Source[]): { name: string | null; isEveryone: boolean } {
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
  // Only worth stating once if it covers most of the list.
  if (name === null || best * 2 <= sources.length) {
    return { name: null, isEveryone: false };
  }
  return { name, isEveryone: best === sources.length };
}

// The one sentence at the top: what's here, what hasn't been done to it yet,
// and who added it. Its counts come from the data, so it stays true as the
// team rates and adds sources.
function headerSentence(sources: Source[], adder: { name: string | null; isEveryone: boolean }): string {
  const total = sources.length;
  const scouted = countScouted(sources);
  const unrated = countUnrated(sources);
  const parts: string[] = [];

  let first = `${total} ${total === 1 ? "source" : "sources"}`;
  if (scouted === total && total > 1) {
    first += ", all from the team's scouting database";
  } else if (scouted === total) {
    first += " from the team's scouting database";
  } else if (scouted > 0) {
    first += `, ${scouted} of them from the team's scouting database`;
  }
  parts.push(`${first}.`);

  if (unrated === total) {
    parts.push(total === 1 ? "It isn't rated on the rubric yet." : "None is rated on the rubric yet.");
  } else if (unrated > 0) {
    parts.push(`${unrated} ${unrated === 1 ? "isn't" : "aren't"} rated on the rubric yet.`);
  }

  if (adder.name && adder.isEveryone) {
    parts.push(`All added by ${adder.name}.`);
  } else if (adder.name) {
    parts.push(`Added by ${adder.name} unless noted.`);
  }
  return parts.join(" ");
}

export default function SourcesPage() {
  // The data folder only ever holds approved sources: the API export filters
  // out everything else, and content/sources.json is hand-checked. The
  // fictional samples stay in the file for the sample milestones that cite
  // them, but they aren't listed here.
  const sources = sortByRegisterId(realSources(getSources()));
  const adder = mostCommonAdder(sources);
  const noneRated = countUnrated(sources) === sources.length;

  return (
    <>
      <PageHeader
        eyebrow="Source database"
        title={
          <>
            What we&rsquo;ve <em>read</em> so far
          </>
        }
        lede={headerSentence(sources, adder)}
      />

      <div className={`container ${styles.body}`}>
        <div className={styles.help}>
          <MarksHelp />
          <p className={styles.helpNote}>
            <DirectionGlyph tone="for" label="A plus sign" /> means the source argues the approach could help, and{" "}
            <DirectionGlyph tone="against" label="a minus sign" /> that it won&rsquo;t help or could make things
            worse. <Link href="/methodology/#credibility">How we rate sources</Link>
          </p>
        </div>

        <SourceDatabase sources={sources} sharedAddedBy={adder.name} hideUnrated={noneRated} />
      </div>
    </>
  );
}
