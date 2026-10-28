import { MilestonePanel } from "@/components/timeline/MilestonePanel";
import { buildTimeline, dependents, flattenItems, indexItems, type TimelineItem } from "@/components/timeline/timelineModel";
import { getSiteData } from "@/lib/data";
import { sourceRefsById } from "@/lib/sources";

import styles from "./DossierSlot.module.css";

// Two live dossiers side by side: a worked example with every section filled
// (the first milestone whose sources disagree), and the first real milestone,
// which shows how a dossier reads while most of it is still unassessed.
export function DossierSlot() {
  const data = getSiteData();
  const groups = buildTimeline(data.milestones, data.nowYear);
  const items = flattenItems(groups);
  if (items.length === 0) {
    return <p className={styles.text}>No milestones to show yet.</p>;
  }

  let full: TimelineItem = items[0];
  for (const candidate of items) {
    if (candidate.view.disagreement.flagged) {
      full = candidate;
      break;
    }
  }
  let sparse: TimelineItem | null = null;
  for (const candidate of items) {
    if (!candidate.milestone.sample && candidate !== full) {
      sparse = candidate;
      break;
    }
  }

  const itemsById = indexItems(groups);
  const sources = sourceRefsById(data.sources);
  const shown = sparse ? [full, sparse] : [full];

  return (
    <div id="dossier-slot" className={styles.pair}>
      {shown.map((item) => (
        <div key={item.milestone.id} className={styles.live}>
          <MilestonePanel
            item={item}
            itemsById={itemsById}
            neededFor={dependents(item.milestone.id, groups)}
            sources={sources}
            headingId={`styleguide-dossier-${item.milestone.id}`}
          />
        </div>
      ))}
    </div>
  );
}
