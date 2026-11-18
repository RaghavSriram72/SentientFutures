import Link from "next/link";

import { TypeMark } from "@/components/common/TypeMark";
import { estimateSummary, type TimelineItem } from "@/components/timeline/timelineModel";
import { enumLabel, milestoneTypeOf } from "@/lib/enums";
import type { MilestoneCategory, Stage } from "@/lib/types";

import styles from "./MilestoneTable.module.css";

// The technology's real milestones as a compact table. Each row is a link that
// opens the milestone's dossier on the timeline. The estimate column only
// appears once at least one milestone has a date; until then the note above
// the table says so once, in place of "No date yet" on every row.
export function MilestoneTable({ items }: { items: TimelineItem[] }) {
  const showEstimate = anyDated(items);
  const cardClass = showEstimate ? `${styles.card} ${styles.withEstimate}` : styles.card;
  return (
    <div className={`paper ${cardClass}`}>
      <div className={styles.head} aria-hidden="true">
        <span>Milestone</span>
        <span>Stage</span>
        {showEstimate && <span>Estimate</span>}
      </div>
      <ol className={styles.list}>
        {items.map((item) => (
          <li key={item.milestone.id}>
            <Link href={`/timeline/#${item.milestone.id}`} className={styles.row}>
              <span className={styles.code}>{item.code}</span>
              <span className={styles.name}>
                {item.milestone.name}
                <TypeLine category={item.milestone.category} />
              </span>
              <span className={styles.stage}>
                <span className={`${styles.swatch} ${stageClass(item.milestone.stage)}`} aria-hidden="true" />
                <span className="visually-hidden">Stage: </span>
                {enumLabel("Stage", item.milestone.stage)}
              </span>
              {showEstimate && <span className={styles.estimate}>{estimateSummary(item)}</span>}
              <span className={styles.arrow} aria-hidden="true">
                &rarr;
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

// The milestone's type, on its own line under the name. The row link reads it
// as "Type: Technical". With a stale enums.json there is no type, and the
// line is left out.
function TypeLine({ category }: { category: MilestoneCategory }) {
  const type = milestoneTypeOf(category);
  if (type === null) {
    return null;
  }
  return <TypeMark type={type} className={styles.type} />;
}

function anyDated(items: TimelineItem[]): boolean {
  for (const item of items) {
    if (item.view.barMode !== "none") {
      return true;
    }
  }
  return false;
}

function stageClass(stage: Stage): string {
  if (stage === "possible") {
    return styles.stage_possible;
  }
  if (stage === "widely_available") {
    return styles.stage_widely_available;
  }
  return styles.stage_actually_helping;
}
