import type { Metadata } from "next";
import Link from "next/link";

import { SampleChip } from "@/components/common/Marks";
import { PageHeader } from "@/components/common/PageHeader";
import { ProvenanceLegend } from "@/components/provenance/Legends";
import { SourceDatabase } from "@/components/sources/SourceDatabase";
import { getSources } from "@/lib/data";
import { RUBRIC_VERSION } from "@/lib/enums";
import type { Source } from "@/lib/types";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Sources",
  description:
    "Every source the team has read and approved, with our summary and how we rated it on evidence type, independence, relevance and credibility.",
};

// Newest first, then by title, so the order is stable between builds.
function sortSources(sources: Source[]): Source[] {
  const sorted = [...sources];
  sorted.sort((a, b) => {
    if (a.year !== b.year) {
      return b.year - a.year;
    }
    return a.title.localeCompare(b.title);
  });
  return sorted;
}

function countSamples(sources: Source[]): number {
  let count = 0;
  for (const source of sources) {
    if (source.sample) {
      count += 1;
    }
  }
  return count;
}

export default function SourcesPage() {
  // The data folder only ever holds approved sources: the API export filters
  // out everything else, and content/sources.json is hand-checked.
  const sources = sortSources(getSources());
  const sampleCount = countSamples(sources);

  return (
    <>
      <PageHeader
        eyebrow="Source database"
        title={
          <>
            Everything we&rsquo;re <em>leaning on</em>
          </>
        }
        lede="Every source the team has read and approved, with our summary and how we rated it. Ratings are categories, not scores, and each one is defined on the methodology page."
      >
        <span className="chip">
          {sources.length} approved {sources.length === 1 ? "source" : "sources"}
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
            means an AI suggested that value and a person checked it.{" "}
            <Link href="/methodology/#credibility">How we rate sources</Link>
          </p>
        </aside>

        {sampleCount > 0 && (
          <p className={styles.sampleNote}>
            <SampleChip />
            {sampleCount === sources.length
              ? "These are fictional placeholders for the prototype. Real sources arrive as the team reviews them."
              : `${sampleCount} of these are fictional placeholders for the prototype.`}
          </p>
        )}

        <SourceDatabase sources={sources} />
      </div>
    </>
  );
}
