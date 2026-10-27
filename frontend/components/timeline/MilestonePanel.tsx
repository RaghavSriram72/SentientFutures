// The selected milestone as a paper dossier: what the estimate is based on, how
// uncertain it is, every forecast, any disagreement, and what would move it.
// Every sentence is a Claim rendered with ClaimText, so its provenance shows.
import Link from "next/link";
import type { ReactNode, Ref } from "react";

import { ExternalLink } from "@/components/common/ExternalLink";
import { ClaimList, ClaimText } from "@/components/provenance/ClaimText";
import { enumDescription, enumLabel } from "@/lib/enums";
import {
  countLabel,
  DISAGREEMENT_GAP_YEARS,
  formatWindow,
  sameForecaster,
  type ForecastView,
} from "@/lib/estimates";
import { shortCitation, type SourceRef } from "@/lib/sources";
import type { Milestone } from "@/lib/types";

import { stageKey } from "./ChartMarks";
import { MiniTimeline } from "./MiniTimeline";
import { estimateSummary, rangeText, sortForecastsByWindow, type TimelineItem } from "./timelineModel";
import styles from "./MilestonePanel.module.css";

interface MilestonePanelProps {
  item: TimelineItem;
  itemsById: Record<string, TimelineItem>;
  neededFor: TimelineItem[];
  sources: Record<string, SourceRef>;
  headingId: string;
  headingRef?: Ref<HTMLHeadingElement>;
  onClose?: () => void;
  onSelectMilestone?: (id: string) => void;
  // When set, the dossier opens with a one-track strip of the timeline.
  nowYear?: number;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// "2026-10-26" -> "26 October 2026". Parsed by hand so time zones can't shift the day.
function formatIsoDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) {
    return iso;
  }
  const year = parts[0];
  const month = MONTHS[Number(parts[1]) - 1];
  const day = Number(parts[2]);
  if (!month || Number.isNaN(day)) {
    return iso;
  }
  return `${day} ${month} ${year}`;
}

// Sources cited by the milestone and by its forecasts, in that order, without repeats.
function linkedSourceIds(milestone: Milestone): string[] {
  const ids: string[] = [];
  for (const id of milestone.source_ids) {
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  for (const forecast of milestone.forecasts) {
    if (!ids.includes(forecast.source_id)) {
      ids.push(forecast.source_id);
    }
  }
  return ids;
}

function everyForecastSaysNever(forecasts: ForecastView[]): boolean {
  for (const forecast of forecasts) {
    if (!forecast.never) {
      return false;
    }
  }
  return forecasts.length > 0;
}

// True when the rule had no pair to compare: every forecast shares a forecaster and source.
function allFromOneForecaster(forecasts: ForecastView[]): boolean {
  for (const forecast of forecasts) {
    if (!sameForecaster(forecasts[0], forecast)) {
      return false;
    }
  }
  return forecasts.length > 0;
}

export function MilestonePanel({
  item,
  itemsById,
  neededFor,
  sources,
  headingId,
  headingRef,
  onClose,
  onSelectMilestone,
  nowYear,
}: MilestonePanelProps) {
  const { milestone, view } = item;
  const key = stageKey(milestone.stage);
  const idLine = [
    item.code,
    enumLabel("MilestoneCategory", milestone.category),
    enumLabel("MilestoneStatus", milestone.status),
  ].join(" · ");

  return (
    <article className={styles.dossier} aria-labelledby={headingId}>
      <Paperclip />

      <header className={styles.header}>
        <div className={styles.idRow}>
          <p className={styles.idLine}>{idLine}</p>
          {onClose && (
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close the dossier">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          )}
        </div>
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className={styles.title}>
          {milestone.name}
        </h2>
        <div className={styles.chips}>
          <span className={`${styles.stageChip} ${styles[`stage_${key}`]}`}>
            <span className={styles.stageDot} aria-hidden="true" />
            {enumLabel("Stage", milestone.stage)}
          </span>
          {milestone.sample && <span className="chip">Sample</span>}
          {view.disagreement.flagged && <span className={styles.stamp}>Sources disagree</span>}
        </div>
        <p className={styles.stageNote}>{enumDescription("Stage", milestone.stage)}</p>
        {nowYear !== undefined && <MiniTimeline item={item} nowYear={nowYear} />}
      </header>

      <dl className={styles.facts}>
        <div>
          <dt>Estimate</dt>
          <dd>{estimateSummary(item)}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{milestone.confidence ? enumLabel("Confidence", milestone.confidence) : "Not set"}</dd>
        </div>
        <div>
          <dt>Forecasts</dt>
          <dd>{view.forecastCount >= 1 ? countLabel(view) : "None yet"}</dd>
        </div>
      </dl>

      <Section number={1} title="Summary">
        <ClaimText claim={milestone.summary} sources={sources} variant="compact" />
      </Section>

      <Section number={2} title="What success looks like">
        <ClaimText claim={milestone.success_criterion} sources={sources} variant="compact" />
      </Section>

      <Section number={3} title="Status">
        <p className={styles.statusLine}>
          <span className="chip">{enumLabel("MilestoneStatus", milestone.status)}</span>
          <span className={styles.muted}>{enumDescription("MilestoneStatus", milestone.status)}</span>
        </p>
        <ClaimText claim={milestone.status_basis} sources={sources} variant="compact" />
        {milestone.achieved_in !== null && (
          <div className={styles.achieved}>
            <p className={styles.bigYear}>
              <span className={styles.bigYearLabel}>Achieved in</span> {milestone.achieved_in}
            </p>
            {milestone.achieved_in_basis && (
              <ClaimText claim={milestone.achieved_in_basis} sources={sources} variant="compact" />
            )}
          </div>
        )}
      </Section>

      <Section number={4} title="Estimate">
        <EstimateBlock item={item} sources={sources} />
      </Section>

      <Section number={5} title="Forecasts">
        <ForecastLedger item={item} sources={sources} />
      </Section>

      <Section number={6} title="Disagreement">
        <DisagreementBlock item={item} sources={sources} />
      </Section>

      <Section number={7} title="Main bottleneck">
        <ClaimText claim={milestone.main_bottleneck} sources={sources} variant="compact" />
      </Section>

      <Section number={8} title="What would move it">
        <div className={styles.moveColumns}>
          <div>
            <h4 className={styles.moveTitle}>
              <span aria-hidden="true">&larr;</span> Earlier
            </h4>
            <ClaimList claims={milestone.would_move_earlier} sources={sources} variant="compact" />
          </div>
          <div>
            <h4 className={styles.moveTitle}>
              Later <span aria-hidden="true">&rarr;</span>
            </h4>
            <ClaimList claims={milestone.would_move_later} sources={sources} variant="compact" />
          </div>
        </div>
      </Section>

      <Section number={9} title="Depends on">
        <DependencyList ids={milestone.depends_on} itemsById={itemsById} onSelectMilestone={onSelectMilestone} />
        {neededFor.length > 0 && (
          <>
            <h4 className={styles.subTitle}>Needed for</h4>
            <DependencyList
              ids={neededFor.map((other) => other.milestone.id)}
              itemsById={itemsById}
              onSelectMilestone={onSelectMilestone}
            />
          </>
        )}
      </Section>

      <Section number={10} title="Sources">
        <SourceList ids={linkedSourceIds(milestone)} sources={sources} />
      </Section>

      <Section number={11} title="Artificial minds questions">
        {milestone.artificial_minds_questions.length > 0 ? (
          <ClaimList claims={milestone.artificial_minds_questions} sources={sources} variant="compact" />
        ) : (
          <p className={styles.empty}>None recorded for this milestone yet.</p>
        )}
      </Section>
    </article>
  );
}

function Section({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  const label = number < 10 ? `0${number}` : String(number);
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        <span className={styles.sectionNumber} aria-hidden="true">
          {label}
        </span>
        {title}
      </h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function EstimateBlock({ item, sources }: { item: TimelineItem; sources: Record<string, SourceRef> }) {
  const { milestone, view } = item;
  const estimate = milestone.estimate;

  let confidence: ReactNode = null;
  if (milestone.confidence) {
    confidence = (
      <p className={styles.confidence}>
        <span className="chip">Confidence · {enumLabel("Confidence", milestone.confidence)}</span>
        <span className={styles.muted}>{enumDescription("Confidence", milestone.confidence)}</span>
      </p>
    );
  }

  if (estimate) {
    return (
      <div className={styles.estimate}>
        <p className={styles.bigYear}>
          <span className={styles.bigYearLabel}>Our range</span> {rangeText(estimate.earliest, estimate.latest)}
        </p>
        {estimate.latest === null && <p className={styles.muted}>No end date. The bar runs off the right edge on purpose.</p>}
        <ClaimText claim={estimate.basis} sources={sources} variant="compact" />
        <p className={styles.setBy}>
          Set by {estimate.set_by} on {formatIsoDate(estimate.set_on)}
        </p>
        {confidence}
        {view.disagreement.flagged && (
          <p className={styles.warnNote}>Our range doesn&apos;t settle the disagreement below. Every forecast stays visible.</p>
        )}
      </div>
    );
  }

  let note = "";
  if (view.barMode === "achieved") {
    note = "It has already happened, so there's nothing left to estimate.";
  } else if (view.barMode === "span" && view.bar) {
    // An open side means at least one forecast is open-ended there (see forecastSpan).
    let span = `The forecasts span ${rangeText(view.bar.start, view.bar.end)}`;
    if (view.bar.start === null) {
      span = `The forecasts run up to ${view.bar.end}, and at least one has no start year`;
    } else if (view.bar.end === null) {
      span = `The forecasts run from ${view.bar.start}, and at least one has no end year`;
    }
    note = `No team estimate yet. ${span}. Our rule doesn't flag them as a disagreement, so we shade that span as a faint band.`;
  } else if (view.barMode === "whiskers" && view.forecastCount === 1) {
    note = "No team estimate. There's only one forecast, so we show it on its own.";
  } else if (view.barMode === "whiskers" && view.disagreement.flagged) {
    note = "No team estimate, and the forecasts disagree too much to summarize. We show each one on its own instead of drawing a band.";
  } else if (view.barMode === "whiskers" && view.disagreement.ruleFlagged) {
    // The team overrode the flag, but forecasts the rule flags never get a band (see estimates.ts).
    note = "No team estimate. Our rule finds these forecasts too far apart to share one band. The team doesn't count that as a disagreement (see below), but a band would still blur them into one range, so we show each one on its own.";
  } else if (view.barMode === "whiskers" && everyForecastSaysNever(view.forecasts)) {
    note = "No team estimate. Every forecast says it will never happen, so there are no years to shade.";
  } else if (view.barMode === "whiskers") {
    // forecastSpan found no band: between them, the forecasts are open-ended on both sides.
    note = "No team estimate. Between them, these forecasts are open-ended on both sides, so a band would cover the whole chart. We show each one on its own instead.";
  } else {
    note = "No estimate yet. We haven't found a forecast for this, and we haven't set our own range.";
  }

  return (
    <div className={styles.estimate}>
      <p className={styles.noEstimate}>No team estimate</p>
      <p className={styles.muted}>{note}</p>
      {confidence}
    </div>
  );
}

function ForecastLedger({ item, sources }: { item: TimelineItem; sources: Record<string, SourceRef> }) {
  const { view } = item;
  if (view.forecastCount === 0) {
    return <p className={styles.empty}>No forecasts recorded yet.</p>;
  }
  const forecasts = sortForecastsByWindow(view.forecasts);
  return (
    <>
      <p className={styles.countLabel}>
        {countLabel(view)}
        {view.expiredCount > 0 && ` · ${view.expiredCount} expired`}
      </p>
      {/* The explicit roles keep table semantics in narrow panels, where the
          CSS turns each row into a card and browsers drop the implicit ones. */}
      <table className={styles.ledger} role="table">
        <caption className="visually-hidden">Every forecast for this milestone, one per row</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              Forecaster
            </th>
            <th scope="col" role="columnheader">
              Made in
            </th>
            <th scope="col" role="columnheader">
              Window
            </th>
            <th scope="col" role="columnheader">
              Quote
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {forecasts.map((forecast) => {
            const source = sources[forecast.source_id];
            return (
              <tr key={forecast.id} role="row" className={forecast.isExpired ? styles.expiredRow : undefined}>
                <th scope="row" role="rowheader" data-label="Forecaster">
                  {forecast.forecaster}
                </th>
                <td role="cell" data-label="Made in" className={styles.mono}>
                  {forecast.made_in}
                </td>
                <td role="cell" data-label="Window">
                  <span className={styles.window}>{formatWindow(forecast)}</span>
                  {forecast.isExpired && <span className={styles.expiredTag}>Expired</span>}
                  <span className={styles.forecastClaim}>{forecast.claim}</span>
                </td>
                <td role="cell" data-label="Quote">
                  <q className={styles.quote}>{forecast.quote}</q>
                  <span className={styles.citation}>
                    {source ? (
                      <ExternalLink href={source.url}>{shortCitation(source)}</ExternalLink>
                    ) : (
                      forecast.source_id
                    )}
                    {forecast.quote_location && ` · ${forecast.quote_location}`}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function DisagreementBlock({ item, sources }: { item: TimelineItem; sources: Record<string, SourceRef> }) {
  const { milestone, view } = item;
  const d = view.disagreement;
  const note = milestone.disagreement_note;

  const reasonList =
    d.reasons.length > 0 ? (
      <ul className={styles.reasons}>
        {d.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    ) : null;

  let heading = "";
  let body: ReactNode = null;
  if (d.flagged && d.decidedBy === "rule") {
    heading = "Flagged by our rule";
    body = (
      <>
        <p>
          At least two forecasts are more than {DISAGREEMENT_GAP_YEARS} years apart, or one says it will never happen
          while another gives a year. Who disagrees:
        </p>
        {reasonList}
      </>
    );
  } else if (d.flagged && d.decidedBy === "team") {
    heading = "Flagged by the team";
    body = (
      <>
        {d.overrideBasis && <ClaimText claim={d.overrideBasis} sources={sources} variant="compact" />}
        <p>{d.ruleFlagged ? "Our rule alone would flag it too:" : "Our rule alone would not have flagged this."}</p>
        {reasonList}
      </>
    );
  } else if (!d.flagged && d.decidedBy === "team") {
    heading = "Not flagged: team override";
    body = (
      <>
        {d.overrideBasis && <ClaimText claim={d.overrideBasis} sources={sources} variant="compact" />}
        {d.ruleFlagged ? (
          <>
            <p>Our rule alone would have flagged this:</p>
            {reasonList}
          </>
        ) : (
          <p>Our rule alone wouldn&apos;t have flagged it either.</p>
        )}
      </>
    );
  } else if (view.forecastCount >= 2) {
    heading = "No disagreement flagged";
    // Say only what the rule actually checked: it skips pairs from one forecaster in one source.
    let text = `We compared the forecasts from different forecasters or sources. No two are more than ${DISAGREEMENT_GAP_YEARS} years apart, and none says never while another gives a year.`;
    if (everyForecastSaysNever(view.forecasts)) {
      text = "Every forecast says it will never happen, so there's nothing to disagree about.";
    } else if (allFromOneForecaster(view.forecasts)) {
      text = "All of these forecasts come from one forecaster in one source. Our rule doesn't compare a forecaster with themselves.";
    }
    body = <p>{text}</p>;
  } else {
    heading = "Nothing to compare yet";
    body = (
      <p>
        {view.forecastCount === 1
          ? "There's only one forecast, so there's nothing to compare it with."
          : "There are no forecasts yet."}
      </p>
    );
  }

  return (
    <div className={`${styles.disagreement} ${d.flagged ? styles.disagreementFlagged : ""}`}>
      <div className={styles.disagreementHead}>
        {d.flagged && <span className={styles.stamp}>Sources disagree</span>}
        <p className={styles.disagreementTitle}>{heading}</p>
      </div>
      <div className={styles.disagreementBody}>{body}</div>
      {note && (
        <div className={styles.disagreementNote}>
          <ClaimText claim={note} sources={sources} variant="compact" />
        </div>
      )}
      <p className={styles.ruleLink}>
        <Link href="/methodology/">How the disagreement rule works</Link>
      </p>
    </div>
  );
}

function DependencyList({
  ids,
  itemsById,
  onSelectMilestone,
}: {
  ids: string[];
  itemsById: Record<string, TimelineItem>;
  onSelectMilestone?: (id: string) => void;
}) {
  if (ids.length === 0) {
    return <p className={styles.empty}>Nothing. This milestone doesn&apos;t wait on another one.</p>;
  }
  return (
    <ul className={styles.dependencies}>
      {ids.map((id) => {
        const other = itemsById[id];
        if (!other) {
          return (
            <li key={id} className={styles.dependencyMissing}>
              <span className={styles.mono}>{id}</span> (not on the timeline yet)
            </li>
          );
        }
        const content = (
          <>
            <span className={styles.dependencyCode}>{other.code}</span>
            <span className={styles.dependencyName}>{other.milestone.name}</span>
            <span className="chip">{enumLabel("MilestoneStatus", other.milestone.status)}</span>
          </>
        );
        return (
          <li key={id}>
            {onSelectMilestone ? (
              <button type="button" className={styles.dependency} onClick={() => onSelectMilestone(id)}>
                {content}
              </button>
            ) : (
              <span className={styles.dependency}>{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SourceList({ ids, sources }: { ids: string[]; sources: Record<string, SourceRef> }) {
  if (ids.length === 0) {
    return <p className={styles.empty}>No sources linked yet.</p>;
  }
  return (
    <ul className={styles.sources}>
      {ids.map((id) => {
        const source = sources[id];
        if (!source) {
          return (
            <li key={id} className={styles.mono}>
              {id}
            </li>
          );
        }
        return (
          <li key={id} className={styles.sourceItem}>
            <ExternalLink href={source.url} className={styles.sourceTitle}>
              {source.title}
            </ExternalLink>
            <span className={styles.sourceMeta}>
              {shortCitation(source)}
              {source.sample && " · sample"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// A small wire paperclip holding the dossier together. Decorative only.
function Paperclip() {
  return (
    <svg className={styles.paperclip} viewBox="0 0 25 62" aria-hidden="true">
      <path d="M9 18 V44 A4 4 0 0 0 17 44 V10 A6.5 6.5 0 0 0 4 10 V50 A8.5 8.5 0 0 0 21 50 V22" />
    </svg>
  );
}
