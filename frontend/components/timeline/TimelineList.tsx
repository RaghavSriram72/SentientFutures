// The timeline as an accessible list. Milestones with something on the dates
// come first, grouped by technology; the ones with no estimate follow in one
// short group. It's built from the same computed view as the 3D track, with the
// track's own glyphs, so the marks and labels always agree.
import {
  AchievedDot,
  FaintRibbonSwatch,
  LineSwatch,
  RibbonSwatch,
} from "@/components/timeline3d/TrackGlyphs";
import { ProvenanceTag } from "@/components/provenance/ProvenanceTag";
import { enumLabel } from "@/lib/enums";
import { countLabel, formatWindow } from "@/lib/estimates";

import {
  estimateSummary,
  hasEstimate,
  sortForecastsByWindow,
  stageKey,
  type TimelineGroup,
  type TimelineItem,
} from "./timelineModel";
import styles from "./TimelineList.module.css";

interface TimelineListProps {
  groups: TimelineGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Lets a row name the milestones it depends on ("Needs: WBE-02").
  itemsById?: Record<string, TimelineItem>;
}

// The same groups, keeping only the items that pass the test.
function splitGroups(groups: TimelineGroup[], keep: (item: TimelineItem) => boolean): TimelineGroup[] {
  const result: TimelineGroup[] = [];
  for (const group of groups) {
    const items = group.items.filter(keep);
    if (items.length > 0) {
      result.push({ ...group, items });
    }
  }
  return result;
}

function countItems(groups: TimelineGroup[]): number {
  let total = 0;
  for (const group of groups) {
    total += group.items.length;
  }
  return total;
}

export function TimelineList({ groups, selectedId, onSelect, itemsById = {} }: TimelineListProps) {
  const dated = splitGroups(groups, hasEstimate);
  const undated = splitGroups(groups, (item) => !hasEstimate(item));
  const datedCount = countItems(dated);
  const undatedCount = countItems(undated);

  return (
    <div className={styles.list}>
      {datedCount > 0 && (
        <section className={styles.part} aria-labelledby="list-dated">
          <h3 id="list-dated" className={styles.partTitle}>
            On the dates <span className={styles.partCount}>({datedCount})</span>
          </h3>
          {dated.map((group) => (
            <section key={group.technology} className={styles.group} aria-labelledby={`list-dated-${group.technology}`}>
              <h4 id={`list-dated-${group.technology}`} className={styles.groupTitle}>
                {group.label}
              </h4>
              <ol className={styles.items}>
                {group.items.map((item) => (
                  <ListRow
                    key={item.milestone.id}
                    item={item}
                    selected={item.milestone.id === selectedId}
                    onSelect={onSelect}
                    itemsById={itemsById}
                  />
                ))}
              </ol>
            </section>
          ))}
        </section>
      )}

      {undatedCount > 0 && (
        <section className={styles.part} aria-labelledby="list-undated">
          <h3 id="list-undated" className={styles.partTitle}>
            No estimate yet <span className={styles.partCount}>({undatedCount})</span>
          </h3>
          <p className={styles.partNote}>No team range and no forecast yet. On the track they stand under Timing unknown.</p>
          {undated.map((group) => (
            <section key={group.technology} className={styles.group} aria-labelledby={`list-undated-${group.technology}`}>
              <h4 id={`list-undated-${group.technology}`} className={styles.groupTitle}>
                {group.label}
              </h4>
              <ol className={`${styles.items} ${styles.itemsCompact}`}>
                {group.items.map((item) => (
                  <ListRow
                    key={item.milestone.id}
                    item={item}
                    selected={item.milestone.id === selectedId}
                    onSelect={onSelect}
                    itemsById={itemsById}
                    compact
                  />
                ))}
              </ol>
            </section>
          ))}
        </section>
      )}
    </div>
  );
}

// The track's mark for this milestone's estimate, in its stage color.
function EstimateGlyph({ item }: { item: TimelineItem }) {
  const { view, milestone } = item;
  if (view.barMode === "achieved") {
    return <AchievedDot stage={milestone.stage} />;
  }
  if (view.barMode === "team") {
    return <RibbonSwatch stage={milestone.stage} open={view.bar !== null && view.bar.end === null} />;
  }
  if (view.barMode === "span") {
    return <FaintRibbonSwatch stage={milestone.stage} />;
  }
  return <LineSwatch disagrees={view.disagreement.flagged} />;
}

function needsText(item: TimelineItem, itemsById: Record<string, TimelineItem>): string {
  const codes: string[] = [];
  for (const id of item.milestone.depends_on) {
    codes.push(itemsById[id] ? itemsById[id].code : id);
  }
  return codes.join(", ");
}

interface ListRowProps {
  item: TimelineItem;
  selected: boolean;
  onSelect: (id: string) => void;
  itemsById: Record<string, TimelineItem>;
  // Rows with no estimate have nothing to show but their name and stage.
  compact?: boolean;
}

function ListRow({ item, selected, onSelect, itemsById, compact = false }: ListRowProps) {
  const { milestone, view } = item;
  const key = stageKey(milestone.stage);
  const disagreement = view.disagreement;
  const forecasts = sortForecastsByWindow(view.forecasts);

  return (
    <li className={`${styles.row} ${selected ? styles.rowSelected : ""}`}>
      <div className={styles.topLine}>
        <span className={styles.code}>{item.code}</span>
        <span className={`${styles.stage} ${styles[`stage_${key}`]}`}>
          <span className={styles.stageDot} aria-hidden="true" />
          {enumLabel("Stage", milestone.stage)}
        </span>
        {milestone.sample && <span className="chip">Sample</span>}
      </div>

      <p className={styles.name}>
        {/* The button stretches over the whole row, so the row is one big target.
            data-row-id lets the track put focus back here. */}
        <button
          type="button"
          className={styles.rowButton}
          aria-pressed={selected}
          data-row-id={milestone.id}
          onClick={() => onSelect(milestone.id)}
        >
          {milestone.name}
        </button>
      </p>

      {!compact && (
        <div className={styles.estimate}>
          <EstimateGlyph item={item} />
          <span className={styles.estimateText}>{estimateSummary(item)}</span>
          {milestone.estimate && <ProvenanceTag kind={milestone.estimate.basis.provenance} plain />}
        </div>
      )}

      {milestone.depends_on.length > 0 && (
        <p className={styles.needs}>
          <span className={styles.needsLabel}>Needs</span> {needsText(item, itemsById)}
        </p>
      )}

      {!compact && forecasts.length > 0 && (
        <ul className={styles.forecasts} aria-label={countLabel(view)}>
          {forecasts.map((forecast) => (
            <li key={forecast.id} className={forecast.isExpired ? styles.expired : undefined}>
              <span className={styles.window}>{formatWindow(forecast)}</span>
              <span className={styles.forecaster}>{forecast.forecaster}</span>
              {forecast.isExpired && <span className={styles.expiredTag}>Expired</span>}
            </li>
          ))}
        </ul>
      )}

      {!compact && (view.forecastCount >= 1 || disagreement.flagged || disagreement.decidedBy === "team") && (
        <div className={styles.footer}>
          {view.forecastCount >= 1 && (
            <span className={styles.meta}>
              {countLabel(view)}
              {view.expiredCount > 0 && ` · ${view.expiredCount} expired`}
            </span>
          )}
          {disagreement.flagged && (
            <span className={styles.flag}>
              <span className={styles.stamp}>Sources disagree</span>
              <span className={styles.flagBy}>
                {disagreement.decidedBy === "team" ? "Flagged by the team" : "Flagged by our rule"}
              </span>
            </span>
          )}
          {!disagreement.flagged && disagreement.decidedBy === "team" && (
            <span className={styles.flagBy}>Not flagged (team decision)</span>
          )}
        </div>
      )}
    </li>
  );
}
