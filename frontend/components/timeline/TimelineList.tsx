// The timeline as an accessible list, grouped by technology. It is built from
// the same computed view as the chart, so the badges and labels always agree.
// It's the default on phones and the easiest path for keyboard and screen reader users.
import { ProvenanceTag } from "@/components/provenance/ProvenanceTag";
import { enumLabel } from "@/lib/enums";
import { countLabel, formatWindow, type MilestoneView } from "@/lib/estimates";

import { stageKey } from "./ChartMarks";
import { MarkGlyph, type MarkKind } from "./MarkLegend";
import { estimateSummary, sortForecastsByWindow, type TimelineGroup, type TimelineItem } from "./timelineModel";
import styles from "./TimelineList.module.css";

interface TimelineListProps {
  groups: TimelineGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function glyphFor(view: MilestoneView): MarkKind {
  if (view.barMode === "achieved") {
    return "achieved";
  }
  if (view.barMode === "team") {
    return view.bar && view.bar.end === null ? "teamOpen" : "team";
  }
  if (view.barMode === "span") {
    return "span";
  }
  if (view.barMode === "whiskers") {
    return "whisker";
  }
  return "none";
}

export function TimelineList({ groups, selectedId, onSelect }: TimelineListProps) {
  return (
    <div className={styles.list}>
      {groups.map((group) => (
        <section key={group.technology} className={styles.group} aria-labelledby={`list-${group.technology}`}>
          <h3 id={`list-${group.technology}`} className={styles.groupTitle}>
            {group.label}
            <span className={styles.groupCount}>
              {group.items.length} {group.items.length === 1 ? "milestone" : "milestones"}
            </span>
          </h3>
          <ol className={styles.items}>
            {group.items.map((item) => (
              <ListRow
                key={item.milestone.id}
                item={item}
                selected={item.milestone.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function ListRow({ item, selected, onSelect }: { item: TimelineItem; selected: boolean; onSelect: (id: string) => void }) {
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

      <h4 className={styles.name}>
        {/* The button stretches over the whole row, so the row is one big target.
            data-row-id lets the explorer put focus back here when the dossier closes. */}
        <button
          type="button"
          className={styles.rowButton}
          aria-pressed={selected}
          data-row-id={milestone.id}
          onClick={() => onSelect(milestone.id)}
        >
          {milestone.name}
        </button>
      </h4>

      <div className={styles.estimate}>
        <MarkGlyph kind={glyphFor(view)} stage={milestone.stage} />
        <span className={view.barMode === "none" ? styles.noEstimate : styles.estimateText}>{estimateSummary(item)}</span>
        {milestone.estimate && <ProvenanceTag kind={milestone.estimate.basis.provenance} plain />}
      </div>

      {forecasts.length > 0 && (
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
    </li>
  );
}
