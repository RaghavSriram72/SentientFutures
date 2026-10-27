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
    "Milestones for whole brain emulation, brain computer interfaces and neuromorphic AI. Each forecast is shown separately, and milestones where forecasts disagree are flagged.",
};

interface ReadingNote {
  kind: MarkKind;
  title: string;
  text: string;
}

const READING_NOTES: ReadingNote[] = [
  {
    kind: "team",
    title: "Our range",
    text: "A solid bar is a range the team set, with the reasons written down. Open the milestone to see the basis, who set it and when. An arrow at the right end means we haven't given it an end date.",
  },
  {
    kind: "span",
    title: "Forecast span",
    text: "A faint band shades the full span of years the forecasts cover. We draw one when there's no team range and our rule doesn't flag the forecasts as disagreeing.",
  },
  {
    kind: "whisker",
    title: "One forecast",
    text: "Each thin line is a forecast. Caps mark the ends of its window, a dot is a single year, and an arrow means the window is open-ended. A gray dashed line is an expired forecast: its window passed and the milestone didn't happen.",
  },
  {
    kind: "never",
    title: "Says never",
    text: "A cross in the Never column means a forecaster said the milestone will never happen. We count that as a forecast, so it sits on the same row as the dated ones.",
  },
  {
    kind: "stamp",
    title: "Sources disagree",
    text: `The red stamp goes on a milestone when two forecasts are more than ${DISAGREEMENT_GAP_YEARS} years apart, or when one says never and another gives a year. It stays even when we've set our own range. The team can override the rule if it publishes a reason, and the dossier shows who disagrees and who made the call.`,
  },
  {
    kind: "none",
    title: "No estimate yet",
    text: "We haven't found a forecast for the milestone, and the team hasn't set a range. On the chart the label always sits just right of the Now line, so don't read its position as a date.",
  },
  {
    kind: "now",
    title: "Now",
    text: "The dashed line marks the current year. Anything before 2020 or after 2100 goes in the narrow column at that edge, and the dossier gives the exact years.",
  },
  {
    kind: "achieved",
    title: "Achieved",
    text: "A check marks the year the milestone was first shown. Its source is cited in the dossier.",
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
            When each milestone might <em>happen</em>
          </>
        }
        lede="The timeline tracks the three stages separately. A technology can take years to go from possible to widely available, and even then it may do nothing for alignment or human agency. Every forecast gets its own mark, next to any range the team has set, and milestones where the forecasts disagree are flagged."
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
          eyebrow="Key"
          title={
            <>
              How to read the <em>chart</em>
            </>
          }
          intro={
            <>
              Color only shows the stage. Everything else is in the shape of each mark, so the chart still works in
              grayscale. The full rules are on the <Link href="/methodology/">methodology page</Link>.
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
