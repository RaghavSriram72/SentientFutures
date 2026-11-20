import Link from "next/link";

import { CodeText } from "@/components/common/CodeText";
import { milestoneAnchor, type CodeIndex } from "@/lib/codes";
import { enumDescription, enumLabel } from "@/lib/enums";
import type { Family, MilestoneCategory, MilestoneCategoryInfo } from "@/lib/types";
import { milestoneCategoryLabel, type MilestoneRow } from "@/lib/workbook";

import { ConfidenceMeter } from "./RatingChip";
import fold from "./sections/FoldRow.module.css";
import type { TimelineRef } from "./sections/pageModel";
import styles from "./MilestoneTable.module.css";

interface MilestoneTableProps {
  rows: MilestoneRow[]; // the family's tab 1a rows, sheet order
  categories: MilestoneCategoryInfo[]; // tab 1a's category headers
  // The timeline milestone of a category, when there is exactly one (WBE).
  timeline: Partial<Record<MilestoneCategory, TimelineRef>>;
  index: CodeIndex;
  family: Family;
}

// The workbook's "1a Milestones" rows for one family, in sheet order. Each row
// is a fold: closed, it shows the milestone, what it applies to, its status,
// whether the criterion is met and the confidence (the sheet's own column
// headers name them); open, what the status means, the rest of the row word
// for word, the category's question and, where one exists, a link to the
// timeline milestone.
// A milestone's category is named with the site's label, the one the timeline
// uses (milestoneCategoryLabel), not the workbook's header.
// A milestone with two rows (BCI M1) gets anchors -1 and -2.
export function MilestoneTable({ rows, categories, timeline, index, family }: MilestoneTableProps) {
  return (
    <div className={styles.table}>
      <div className={styles.head} aria-hidden="true">
        <span>Milestone</span>
        <span>Applies to</span>
        <span>Status</span>
        <span>Criterion met?</span>
        <span>Confidence</span>
      </div>
      {rows.map((row) => {
        const info = categories.find((item) => item.id === row.assessment.milestone);
        return (
          <MilestoneRowView
            key={milestoneAnchor(family, row.assessment.milestone, row.part)}
            row={row}
            info={info}
            timelineRef={timeline[row.assessment.category]}
            index={index}
            family={family}
          />
        );
      })}
    </div>
  );
}

function MilestoneRowView({
  row,
  info,
  timelineRef,
  index,
  family,
}: {
  row: MilestoneRow;
  info: MilestoneCategoryInfo | undefined;
  timelineRef: TimelineRef | undefined;
  index: CodeIndex;
  family: Family;
}) {
  const { assessment, part } = row;
  const label = info ? milestoneCategoryLabel(info) : enumLabel("MilestoneCategory", assessment.category);
  const statusLabel = enumLabel("MilestoneStatus", assessment.status);
  // What the status chip means, from the shared enums (the timeline's
  // milestone panel shows the same line). Unclear has no description.
  const statusDescription = enumDescription("MilestoneStatus", assessment.status);
  const facts: { label: string; text: string | null | undefined }[] = [
    { label: "Success criterion", text: assessment.success_criterion },
    { label: "Evidence (entries and basis)", text: assessment.evidence },
    { label: "Main bottleneck", text: assessment.bottleneck },
    { label: "Timing (dated sources only)", text: assessment.timing },
    { label: "Note", text: assessment.note },
  ];
  return (
    <details id={milestoneAnchor(family, assessment.milestone, part)} className={`${fold.row} ${styles.row}`}>
      <summary className={styles.summary}>
        <span className={styles.code}>{assessment.milestone}</span>
        <span className={styles.name}>{label}</span>
        <span className={styles.applies}>
          <span className={styles.cellLabel}>Applies to</span>
          {assessment.applies_to}
        </span>
        {/* On phones a small two-column grid, sheet header beside value, the
            same on every row; on a wide table each is a column (display:
            contents), lined up under the header row. */}
        <span className={styles.meta}>
          <span className={styles.status}>
            <span className={styles.cellLabel}>Status</span>
            <span className={styles.cellValue}>
              <span className={`chip ${styles.chip}`}>{statusLabel}</span>
            </span>
          </span>
          <span className={styles.met}>
            <span className={styles.cellLabel}>Criterion met?</span>
            <span className={styles.cellValue}>{assessment.criterion_met}</span>
          </span>
          <span className={styles.confidence}>
            <span className={styles.cellLabel}>Confidence</span>
            <span className={styles.cellValue}>
              <ConfidenceMeter confidence={assessment.confidence} />
            </span>
          </span>
        </span>
        <span className={fold.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.body}>
        <dl className={fold.facts}>
          {/* The status chip's label as the term, its meaning beside it. */}
          {statusDescription !== "" && (
            <div className={fold.fact}>
              <dt className={fold.factLabel}>{statusLabel}</dt>
              <dd className={fold.factValue}>{statusDescription}</dd>
            </div>
          )}
          {facts.map((fact) =>
            fact.text && fact.text.trim() !== "" ? (
              <div key={fact.label} className={fold.fact}>
                <dt className={fold.factLabel}>{fact.label}</dt>
                <dd className={fold.factValue}>
                  <CodeText text={fact.text} index={index} family={family} />
                </dd>
              </div>
            ) : null,
          )}
        </dl>
        {info && (
          <div className={styles.question}>
            <p className={fold.factLabel}>
              {info.id} {label}
            </p>
            <p className={styles.questionText}>{info.question}</p>
          </div>
        )}
        {timelineRef && (
          <p className={styles.timelineLink}>
            <Link href={`/timeline/#${timelineRef.id}`}>
              On the timeline: {timelineRef.code}
              <span aria-hidden="true"> &rarr;</span>
            </Link>
          </p>
        )}
      </div>
    </details>
  );
}
