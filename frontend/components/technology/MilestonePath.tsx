import Link from "next/link";

import { estimateSummary, type TimelineItem } from "@/components/timeline/timelineModel";
import { enumDescription, enumLabel, enumValues } from "@/lib/enums";
import { countLabel } from "@/lib/estimates";
import type { Stage } from "@/lib/types";

import styles from "./MilestonePath.module.css";

interface MilestonePathProps {
  // This technology's milestones, as the timeline model built them (with codes).
  items: TimelineItem[];
}

// The technology's milestones laid out along the three stages: possible, then
// widely available, then actually helping. An empty stage says so, because
// a gap in the path is worth seeing.
export function MilestonePath({ items }: MilestonePathProps) {
  const stages = enumValues("Stage");
  return (
    <ol className={styles.path}>
      {stages.map((stageInfo, index) => {
        const stage = stageInfo.value as Stage;
        const stageItems = itemsInStage(items, stage);
        return (
          <li key={stage} className={`${styles.stage} ${stageClass(stage)}`}>
            <div className={styles.stageHead}>
              <p className={styles.stageNumber}>Stage {index + 1}</p>
              <h3 className={styles.stageName}>{stageInfo.label}</h3>
              <p className={styles.stageDesc}>{enumDescription("Stage", stage)}</p>
            </div>
            {stageItems.length === 0 ? (
              <p className={styles.empty}>No milestones mapped at this stage yet.</p>
            ) : (
              <ul className={styles.cards}>
                {stageItems.map((item) => (
                  <li key={item.milestone.id}>
                    <MilestoneCard item={item} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function itemsInStage(items: TimelineItem[], stage: Stage): TimelineItem[] {
  const found: TimelineItem[] = [];
  for (const item of items) {
    if (item.milestone.stage === stage) {
      found.push(item);
    }
  }
  return found;
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

function MilestoneCard({ item }: { item: TimelineItem }) {
  const { milestone, view } = item;
  const forecastText = view.forecastCount > 0 ? countLabel(view) : "No forecasts yet";

  return (
    <Link href="/timeline/" className={styles.card}>
      <span className={styles.cardTop}>
        <span className={styles.code}>
          {item.code} · {enumLabel("MilestoneCategory", milestone.category)}
        </span>
        {milestone.sample && <span className={styles.sampleTag}>Sample</span>}
      </span>

      <span className={styles.name}>{milestone.name}</span>

      <span className={styles.meta}>
        <span className="chip">
          <span className={styles.swatch} aria-hidden="true" />
          {enumLabel("Stage", milestone.stage)}
        </span>
        <span className="chip">{enumLabel("MilestoneStatus", milestone.status)}</span>
        {view.disagreement.flagged && <span className={styles.disagree}>Sources disagree</span>}
      </span>

      <span className={styles.footer}>
        <span>{estimateSummary(item)}</span>
        <span>{forecastText}</span>
      </span>
      <span className={styles.arrow} aria-hidden="true">
        &rarr;
      </span>
    </Link>
  );
}
