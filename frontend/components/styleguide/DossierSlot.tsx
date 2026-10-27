import { MilestonePanel } from "@/components/timeline/MilestonePanel";
import { buildTimeline, dependents, flattenItems, indexItems } from "@/components/timeline/timelineModel";
import { getSiteData } from "@/lib/data";
import { sourceRefsById } from "@/lib/sources";

import styles from "./DossierSlot.module.css";

// The real milestone dossier, rendered with the first milestone where sources
// disagree (or the first milestone if none do), so the style tile shows it live.
export function DossierSlot() {
  const data = getSiteData();
  const groups = buildTimeline(data.milestones, data.nowYear);
  const items = flattenItems(groups);
  if (items.length === 0) {
    return <p className={styles.text}>No milestones to show yet.</p>;
  }

  let item = items[0];
  for (const candidate of items) {
    if (candidate.view.disagreement.flagged) {
      item = candidate;
      break;
    }
  }

  return (
    <div id="dossier-slot" className={styles.live}>
      <MilestonePanel
        item={item}
        itemsById={indexItems(groups)}
        neededFor={dependents(item.milestone.id, groups)}
        sources={sourceRefsById(data.sources)}
        headingId="styleguide-dossier-title"
        nowYear={data.nowYear}
      />
    </div>
  );
}
