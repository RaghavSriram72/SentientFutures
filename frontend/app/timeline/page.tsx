import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/common/PageHeader";
import { SectionHead } from "@/components/common/SectionHead";
import { MarkGlyph, type MarkKind } from "@/components/timeline/MarkLegend";
import { TimelineExplorer } from "@/components/timeline/TimelineExplorer";
import { getSiteData } from "@/lib/data";
import { enumValues } from "@/lib/enums";
import { DISAGREEMENT_GAP_YEARS } from "@/lib/estimates";
import { sourceRefsById } from "@/lib/sources";
import type { Stage } from "@/lib/types";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Timeline",
  description:
    "Milestones for brain emulation, brain computer interfaces and neuromorphic AI, with every forecast shown on its own and disagreement flagged instead of averaged away.",
};

interface ReadingNote {
  kind: MarkKind;
  title: string;
  text: string;
}

const READING_NOTES: ReadingNote[] = [
  {
    kind: "team",
    title: "A solid bar is our range",
    text: "The team set it and wrote down why. Open the milestone to read the basis, who set it and when. An arrow at the end means we haven't given it an end date.",
  },
  {
    kind: "span",
    title: "A faint band is the forecasts' span",
    text: "When there's no team range and the forecasts roughly agree, we shade the years they cover. It's a summary of the forecasts, not a prediction of ours.",
  },
  {
    kind: "whisker",
    title: "Each thin line is one forecast",
    text: "Caps mark a window, a dot is a single year, and an arrow means open-ended. Grey dashed lines have expired: the window passed and it didn't happen.",
  },
  {
    kind: "never",
    title: "The Never column",
    text: "A cross here means a forecaster said it will never happen. It sits next to the dated forecasts, because it's a forecast too.",
  },
  {
    kind: "stamp",
    title: "The red stamp means sources disagree",
    text: `Two forecasts are more than ${DISAGREEMENT_GAP_YEARS} years apart, or one says never while another gives a year. A team range never hides the stamp. The team can overrule our rule, but only with a published reason, and the dossier says who disagrees and who decided.`,
  },
  {
    kind: "none",
    title: "Hatched means no estimate yet",
    text: "We haven't found a forecast and haven't set a range. That's a gap in the evidence, not a hint that it's far off.",
  },
  {
    kind: "now",
    title: "The dashed line is now",
    text: "Years before 2020 and after 2100 sit in the narrow columns at each edge. The dossier always gives the exact years.",
  },
  {
    kind: "achieved",
    title: "A check means it happened",
    text: "Marked at the year it was first shown, with the source for that claim in the dossier.",
  },
];

export default function TimelinePage() {
  const site = getSiteData();
  const sources = sourceRefsById(site.sources);
  const stages = enumValues("Stage");

  return (
    <>
      <PageHeader
        eyebrow={`Timeline · ${site.milestones.length} milestones`}
        title={
          <>
            When might these technologies <em>actually</em> help?
          </>
        }
        lede="A technology can be possible years before it's widely available, and widely available without helping with alignment or human agency at all. So each step is its own milestone. We don't boil disagreeing forecasts down to one date: every forecast stays on the chart, next to any range we set ourselves."
      >
        <ol className={styles.stageSteps} aria-label="The three stages, in order">
          {stages.map((info, index) => (
            <li key={info.value} className={`${styles.stageStep} ${styles[`step_${info.value as Stage}`]}`}>
              <span className={styles.stepNumber}>{index + 1}</span>
              <span className={styles.stepDot} aria-hidden="true" />
              {info.label}
            </li>
          ))}
        </ol>
      </PageHeader>

      <section className={`container ${styles.explorerSection}`} aria-labelledby="timeline-explorer-title">
        {/* Hidden, but it gives the list's h3 groups and h4 rows a parent heading */}
        <h2 id="timeline-explorer-title" className="visually-hidden">
          Interactive timeline
        </h2>
        <TimelineExplorer milestones={site.milestones} sources={sources} nowYear={site.nowYear} />
      </section>

      <section className={`container section ${styles.howTo}`} aria-labelledby="how-to-read">
        <SectionHead
          id="how-to-read"
          eyebrow="Reading the chart"
          title={
            <>
              How to <em>read</em> this
            </>
          }
          intro={
            <>
              Color only tells you the stage. Everything else is in the shape of the mark, so the chart reads in
              grayscale too. The full rules are on the <Link href="/methodology/">methodology page</Link>.
            </>
          }
        />
        <ul className={styles.notes}>
          {READING_NOTES.map((note) => (
            <li key={note.kind} className={`paper reveal ${styles.note}`}>
              <span className={styles.noteGlyph}>
                <MarkGlyph kind={note.kind} />
              </span>
              <h3 className={styles.noteTitle}>{note.title}</h3>
              <p className={styles.noteText}>{note.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
