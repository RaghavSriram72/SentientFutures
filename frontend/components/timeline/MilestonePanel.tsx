// The selected milestone as a paper dossier. The top layer fits on one screen:
// what it is, one line for the estimate, one line for what that rests on, and
// what nobody has assessed yet. Below that come only the sections that have
// something in them. Every sentence is a Claim rendered with ClaimText, so its
// provenance shows, except the workbook's own cells from its milestone tab
// (1a): criterion met, timing, note and the rest are plain strings shown word
// for word, with their codes linked (CodeText). The 1a cells stored as team
// claims (evidence, success criterion, main bottleneck) go through
// WorkbookClaim, which keeps the provenance mark and the same bare links.
import Link from "next/link";
import type { ReactNode, Ref } from "react";

import { CodeText } from "@/components/common/CodeText";
import { ExternalLink } from "@/components/common/ExternalLink";
import { TypeMark } from "@/components/common/TypeMark";
import { ClaimList, ClaimText } from "@/components/provenance/ClaimText";
import provenanceStyles from "@/components/provenance/Provenance.module.css";
import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { registerIdsIn, type CodeIndex } from "@/lib/codes";
import { enumDescription, enumLabel, milestoneTypeOf } from "@/lib/enums";
import {
  countLabel,
  DISAGREEMENT_GAP_YEARS,
  formatWindow,
  pluralize,
  sameForecaster,
  type ForecastView,
} from "@/lib/estimates";
import { shortCitation, type SourceRef } from "@/lib/sources";
import type { Claim, Milestone, Provenance, Technology } from "@/lib/types";

import { dossierCodeIndex } from "./dossierCodes";
import {
  forecastRangeText,
  rangeText,
  sortForecastsByWindow,
  stageKey,
  stageTag,
  type TimelineItem,
} from "./timelineModel";
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
  // Link the technology to its page and each listed source to its entry in
  // the source database. The timeline turns this on. The admin preview leaves
  // it off, since following a link there would leave unsaved edits behind.
  siteLinks?: boolean;
  // No longer used (the dossier used to draw a strip of the old chart). Kept
  // so existing callers still compile.
  nowYear?: number;
  // Where the workbook's codes link (buildCodeIndex in lib/codes.ts). Without
  // it, and with siteLinks on, the dossier links the entries the milestone
  // lists and the site's sources (dossierCodes.ts). Without siteLinks the
  // codes stay plain text.
  codeIndex?: CodeIndex;
}

// The technologies with a page of their own (/wbe/ and so on).
const TECHNOLOGY_PAGES: Technology[] = ["wbe", "bci", "neuromorphic"];

// The dossier's default kind. The team's claims carry no mark at all (anything
// unmarked is the team's), and every other kind keeps its tag.
const DOSSIER_DEFAULT: Provenance = "team";

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

// Lowercase, letters and digits only, single spaces: for spotting text that
// just repeats the title.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameText(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

// A claim that only says the team hasn't looked yet ("We haven't assessed what
// would bring this forward") counts as not assessed, not as content.
function isPlaceholder(claim: Claim): boolean {
  return claim.provenance === "unclear" && claim.unclear_reason === "search_incomplete";
}

function hasContent(claims: Claim[]): boolean {
  for (const claim of claims) {
    if (!isPlaceholder(claim)) {
      return true;
    }
  }
  return false;
}

// True when the claim has words in it. Published milestones fill every claim,
// but a new milestone in the admin preview starts with empty ones to fill
// in, and an empty claim would draw its provenance bullet on its own. So a
// claim without text is left out, and so is a heading with nothing left
// under it. Each comes back as soon as its field gets text.
function hasText(claim: Claim): boolean {
  return claim.text.trim() !== "";
}

// The claims that have words in them, in their order (see hasText).
function claimsWithText(claims: Claim[]): Claim[] {
  const kept: Claim[] = [];
  for (const claim of claims) {
    if (hasText(claim)) {
      kept.push(claim);
    }
  }
  return kept;
}

// "a", "a and b", "a, b and c"
function joinWords(words: string[]): string {
  if (words.length <= 1) {
    return words.join("");
  }
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

// True when every id in `ids` is also in `list` (and so when `ids` is empty).
function everyIdIn(ids: string[], list: string[]): boolean {
  for (const id of ids) {
    if (!list.includes(id)) {
      return false;
    }
  }
  return true;
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

// The one-line estimate: "No date yet", "Team range 2030 to 2040 · medium
// confidence", or "3 forecasts, 2032 to never · sources disagree".
function estimateLine(item: TimelineItem): string {
  const { milestone, view } = item;
  if (view.barMode === "achieved") {
    return `Achieved in ${view.achievedIn}`;
  }
  const parts: string[] = [];
  if (milestone.estimate) {
    let team = `Team range ${rangeText(milestone.estimate.earliest, milestone.estimate.latest)}`;
    if (milestone.confidence) {
      team += ` · ${enumLabel("Confidence", milestone.confidence).toLowerCase()} confidence`;
    }
    parts.push(team);
  }
  if (view.forecastCount > 0) {
    parts.push(`${pluralize(view.forecastCount, "forecast", "forecasts")}, ${forecastRangeText(view)}`);
  }
  if (view.disagreement.flagged) {
    parts.push("sources disagree");
  }
  if (parts.length === 0) {
    return "No date yet";
  }
  return parts.join(" · ");
}

// What nobody has filled in yet, for the one "Not yet assessed" line.
function notYetAssessed(item: TimelineItem, neededFor: TimelineItem[]): string[] {
  const { milestone, view } = item;
  const missing: string[] = [];
  const achieved = view.barMode === "achieved";
  if (!achieved && !milestone.estimate) {
    missing.push("a team range");
  }
  if (!achieved && view.forecastCount === 0) {
    missing.push("forecasts");
  }
  if (milestone.depends_on.length === 0 && neededFor.length === 0) {
    missing.push("dependencies");
  }
  // Empty claims (a new milestone in the admin preview) count as missing too,
  // since the panel hides them (see hasText). That way this line lists every
  // section the panel leaves out.
  if (
    !achieved &&
    !hasContent(claimsWithText(milestone.would_move_earlier)) &&
    !hasContent(claimsWithText(milestone.would_move_later))
  ) {
    missing.push("what would change the timing");
  }
  if (!milestone.main_bottleneck || !hasText(milestone.main_bottleneck) || isPlaceholder(milestone.main_bottleneck)) {
    missing.push("the main bottleneck");
  }
  if (!hasContent(claimsWithText(milestone.artificial_minds_questions))) {
    missing.push("questions about artificial minds");
  }
  return missing;
}

// A forecast's own one-line claim, unless it only repeats its window
// ("First results between 2030 and 2033" next to "2030 to 2033").
function forecastClaimAddsSomething(forecast: ForecastView): boolean {
  const claim = normalize(forecast.claim);
  const window = normalize(formatWindow(forecast));
  if (claim === window) {
    return false;
  }
  const years = window.match(/\d{4}/g) ?? [];
  for (const year of years) {
    if (!claim.includes(year)) {
      return true;
    }
  }
  return claim.split(" ").length > 7;
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
  siteLinks = false,
  codeIndex,
}: MilestonePanelProps) {
  const { milestone, view } = item;
  const index = siteLinks ? (codeIndex ?? dossierCodeIndex(milestone, sources)) : null;
  // The workbook's milestone tab (1a) fills these. When it has assessed the
  // milestone, status_basis holds the tab's "Evidence (entries and basis)"
  // cell, so it is shown under "Evidence".
  const criterionMet = textOrNull(milestone.criterion_met);
  const appliesTo = textOrNull(milestone.applies_to);
  const timing = textOrNull(milestone.timing);
  const note = textOrNull(milestone.note);
  const assessmentConfidence = milestone.assessment_confidence ?? null;
  const fromWorkbook = criterionMet !== null || (milestone.evidence_entries ?? []).length > 0;
  const hasFacts = criterionMet !== null || assessmentConfidence !== null || appliesTo !== null;
  const statusDescription = enumDescription("MilestoneStatus", milestone.status);
  const key = stageKey(milestone.stage);
  // null only with a stale enums.json, and then the line shows the category alone
  const type = milestoneTypeOf(milestone.category);
  const missing = notYetAssessed(item, neededFor);
  // The summary is left out when it only repeats the title, or when it is
  // empty. Published milestones always have one, but a new milestone in the
  // admin preview starts without, and an empty summary would draw its
  // provenance bullet on its own.
  const summaryIsEmpty = !hasText(milestone.summary);
  const showSummary = !summaryIsEmpty && !sameText(milestone.summary.text, milestone.name);
  // The other claims follow the same rule (see hasText): an empty one is left
  // out, and so is a heading with nothing left under it. A status basis or a
  // main bottleneck that only says nobody has looked yet is left out too, so
  // the status chip and its line stand alone.
  const showStatusBasis = hasText(milestone.status_basis) && !isPlaceholder(milestone.status_basis);
  const showSuccess = hasText(milestone.success_criterion) && !sameText(milestone.success_criterion.text, milestone.name);
  // The workbook leaves some bottlenecks empty, so it may be null.
  const bottleneck = milestone.main_bottleneck;
  const showBottleneck = bottleneck !== null && hasText(bottleneck) && !isPlaceholder(bottleneck);
  const mindsQuestions = claimsWithText(milestone.artificial_minds_questions);
  const earlierClaims = claimsWithText(milestone.would_move_earlier);
  const laterClaims = claimsWithText(milestone.would_move_later);
  const sourceIds = linkedSourceIds(milestone);
  const hasDependencies = milestone.depends_on.length > 0 || neededFor.length > 0;
  const hasMinds = hasContent(mindsQuestions);
  const hasEstimateSection = milestone.estimate !== null || view.forecastCount > 0;
  const hasTiming = hasContent(earlierClaims) || hasContent(laterClaims);
  // When the Sources list at the bottom already holds every source the status
  // basis cites, its "See ..." line would only repeat them, so it goes. A
  // basis that cites a source outside the list keeps it.
  const statusSourcesListed = everyIdIn(milestone.status_basis.source_ids ?? [], sourceIds);

  let technology: ReactNode = enumLabel("Technology", milestone.technology);
  if (siteLinks && TECHNOLOGY_PAGES.includes(milestone.technology)) {
    technology = (
      <Link href={`/${milestone.technology}/`} className={styles.technologyLink}>
        {technology}
      </Link>
    );
  }

  return (
    <article className={styles.dossier} aria-labelledby={headingId}>
      <Paperclip />

      {/* Outside the header, so on a phone it can stay pinned to the top of
          the sheet (with its close button) while the rest scrolls. */}
      <div className={`${styles.idRow} ${onClose ? styles.idRowPinned : ""}`}>
        <p className={styles.idLine}>
          {item.code} &middot; {technology}
        </p>
        <p className={`${styles.stageChip} ${styles[`stage_${key}`]}`}>
          <span className={styles.stageDot} aria-hidden="true" />
          {stageTag(milestone.stage)}
        </p>
        {onClose && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close the dossier">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        )}
      </div>

      <header className={styles.header}>
        {/* What the stage chip means, in words, so keyboard and touch readers
            get it too (it used to be a hover title). */}
        <p className={styles.stageNote}>{enumDescription("Stage", milestone.stage)}</p>
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className={styles.title}>
          {milestone.name}
        </h2>
        {/* The type, then the category it comes from. It sits here, not in
            the pinned id row, so the phone sheet's pinned row stays short. */}
        <p className={styles.typeLine}>
          {type && <TypeMark type={type} />}
          <span className={styles.category}>
            {/* Hangs in the gap before the category (see the CSS), so it
                never ends a line on its own */}
            {type && (
              <span className={styles.typeDot} aria-hidden="true">
                &middot;
              </span>
            )}
            <span className="visually-hidden">Category: </span>
            {enumLabel("MilestoneCategory", milestone.category)}
          </span>
        </p>
        {(milestone.sample || view.disagreement.flagged) && (
          <div className={styles.chips}>
            {milestone.sample && <span className="chip">Sample</span>}
            {view.disagreement.flagged && <span className={styles.stamp}>Sources disagree</span>}
          </div>
        )}
        {showSummary && (
          <div className={styles.summary}>
            <ClaimText claim={milestone.summary} sources={sources} variant="compact" quiet={DOSSIER_DEFAULT} />
          </div>
        )}
      </header>

      <div className={styles.topLayer}>
        <p className={styles.estimateLine}>{estimateLine(item)}</p>
        <BasedOn item={item} sources={sources} />
        {timing !== null && (
          <div className={styles.basedOn}>
            {/* The workbook's "Timing (dated sources only)" column, under a
                plain-words label */}
            <span className={styles.basedOnLabel}>What sources say about timing</span>
            <p className={styles.basedOnText}>
              <WorkbookText text={timing} index={index} />
            </p>
          </div>
        )}
        {missing.length > 0 && (
          <p className={styles.notAssessed}>
            <span className={styles.notAssessedGlyph}>
              <ProvenanceGlyph kind="unclear" />
            </span>
            <span>
              <span className={styles.notAssessedLabel}>Not yet assessed:</span> {joinWords(missing)}.
            </span>
          </p>
        )}
      </div>

      {hasDependencies && (
        <Section title={dependencyTitle(milestone.depends_on.length > 0, neededFor.length > 0)}>
          {milestone.depends_on.length > 0 && (
            <DependencyChips
              label={neededFor.length > 0 ? "Depends on" : null}
              ids={milestone.depends_on}
              itemsById={itemsById}
              onSelectMilestone={onSelectMilestone}
            />
          )}
          {neededFor.length > 0 && (
            <DependencyChips
              label={milestone.depends_on.length > 0 ? "Needed for" : null}
              ids={neededFor.map((other) => other.milestone.id)}
              itemsById={itemsById}
              onSelectMilestone={onSelectMilestone}
            />
          )}
        </Section>
      )}

      {hasMinds && (
        <Section title="Questions about artificial minds">
          <ClaimList claims={mindsQuestions} sources={sources} variant="compact" quiet={DOSSIER_DEFAULT} />
        </Section>
      )}

      <Section title="Status">
        <p className={styles.statusLine}>
          <span className="chip">{enumLabel("MilestoneStatus", milestone.status)}</span>
          {/* Unclear has no description of its own, so its chip stands alone */}
          {statusDescription !== "" && <span className={styles.muted}>{statusDescription}</span>}
        </p>
        {/* The workbook's headers, word for word. "Confidence" here is the
            tab's confidence in the status, shown with or without a team range. */}
        {hasFacts && (
          <dl className={styles.facts}>
            {criterionMet !== null && (
              <div className={styles.fact}>
                <dt>Criterion met?</dt>
                <dd>
                  <WorkbookText text={criterionMet} index={index} />
                </dd>
              </div>
            )}
            {assessmentConfidence !== null && (
              <div className={styles.fact}>
                <dt>Confidence</dt>
                <dd>{enumLabel("Confidence", assessmentConfidence)}</dd>
              </div>
            )}
            {appliesTo !== null && (
              <div className={styles.fact}>
                <dt>Applies to</dt>
                <dd>
                  <WorkbookText text={appliesTo} index={index} />
                </dd>
              </div>
            )}
          </dl>
        )}
        {showStatusBasis &&
          (fromWorkbook ? (
            <div className={styles.success}>
              <h4 className={styles.subTitle}>Evidence</h4>
              <WorkbookClaim
                claim={milestone.status_basis}
                index={index}
                sources={sources}
                hideCitation={statusSourcesListed}
                fromWorkbook={fromWorkbook}
              />
            </div>
          ) : (
            <WorkbookClaim
              claim={milestone.status_basis}
              index={index}
              sources={sources}
              hideCitation={statusSourcesListed}
              fromWorkbook={fromWorkbook}
            />
          ))}
        {showSuccess && (
          <div className={styles.success}>
            <h4 className={styles.subTitle}>Counts as reached when</h4>
            <WorkbookClaim
              claim={milestone.success_criterion}
              index={index}
              sources={sources}
              hideCitation={false}
              fromWorkbook={fromWorkbook}
            />
          </div>
        )}
        {note !== null && (
          <div className={styles.success}>
            <h4 className={styles.subTitle}>Note</h4>
            <p className={styles.workbookText}>
              <WorkbookText text={note} index={index} />
            </p>
          </div>
        )}
      </Section>

      {hasEstimateSection && (
        <Section title="Estimate and forecasts">
          <EstimateBlock item={item} />
          {view.forecastCount > 0 && <ForecastLedger item={item} sources={sources} />}
          {(view.forecastCount >= 2 || view.disagreement.decidedBy === "team") && <DisagreementBlock item={item} sources={sources} />}
        </Section>
      )}

      {hasTiming && (
        <Section title="What would change the timing">
          {/* A side whose claims are all empty (see hasText) is left out,
              heading and all. A side that only says nobody has looked yet
              keeps its heading, with "Not assessed yet." under it. */}
          <div className={styles.moveColumns}>
            {earlierClaims.length > 0 && (
              <div>
                <h4 className={styles.moveTitle}>
                  <span aria-hidden="true">&larr;</span> Earlier
                </h4>
                {hasContent(earlierClaims) ? (
                  <ClaimList claims={earlierClaims} sources={sources} variant="compact" quiet={DOSSIER_DEFAULT} />
                ) : (
                  <p className={styles.empty}>Not assessed yet.</p>
                )}
              </div>
            )}
            {laterClaims.length > 0 && (
              <div>
                <h4 className={styles.moveTitle}>
                  Later <span aria-hidden="true">&rarr;</span>
                </h4>
                {hasContent(laterClaims) ? (
                  <ClaimList claims={laterClaims} sources={sources} variant="compact" quiet={DOSSIER_DEFAULT} />
                ) : (
                  <p className={styles.empty}>Not assessed yet.</p>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      {showBottleneck && bottleneck && (
        <Section title="Main bottleneck">
          <WorkbookClaim claim={bottleneck} index={index} sources={sources} hideCitation={false} fromWorkbook={fromWorkbook} />
        </Section>
      )}

      {sourceIds.length > 0 && (
        <Section title="Sources">
          <SourceList ids={sourceIds} sources={sources} siteLinks={siteLinks} />
        </Section>
      )}
    </article>
  );
}

// A workbook cell with words in it, or null for an empty or missing one.
function textOrNull(text: string | null | undefined): string | null {
  if (text === null || text === undefined || text.trim() === "") {
    return null;
  }
  return text;
}

// A workbook cell word for word, with its codes linked when the dossier links
// out (see codeIndex); plain text otherwise.
function WorkbookText({ text, index }: { text: string; index: CodeIndex | null }) {
  if (index === null) {
    return <>{text}</>;
  }
  return <CodeText text={text} index={index} />;
}

// A team claim (status basis, success criterion, main bottleneck), drawn like
// ClaimText's unmarked team claim but with every workbook code linked (E037
// to the evidence register, S13 to the source), not only the sources. For a
// milestone filled from the workbook's tab 1a these are its cells, so they
// stay word for word: a source id links bare, like the note and timing beside
// them. Site-written text shows "(Author Year)" after a source id, as
// ClaimText does. A dossier that doesn't link out (the admin preview, the
// styleguide) shows a workbook cell the same way, word for word with no
// "(Author Year)" added, only without links. Any other kind of claim, or
// site-written text in a dossier that doesn't link out, keeps ClaimText.
function WorkbookClaim({
  claim,
  index,
  sources,
  hideCitation,
  fromWorkbook,
}: {
  claim: Claim;
  index: CodeIndex | null;
  sources: Record<string, SourceRef>;
  hideCitation: boolean;
  fromWorkbook: boolean;
}) {
  if (claim.provenance !== DOSSIER_DEFAULT || (index === null && !fromWorkbook)) {
    return (
      <ClaimText claim={claim} sources={sources} variant="compact" quiet={DOSSIER_DEFAULT} hideCitation={hideCitation} />
    );
  }
  // The "See ..." line, as ClaimText builds it: the claim's sources that its
  // text doesn't already name by register id.
  const namedInText = registerIdsIn(claim.text);
  const seeAlso: SourceRef[] = [];
  for (const id of claim.source_ids ?? []) {
    const source = sources[id];
    if (source && (!source.register_id || !namedInText.includes(source.register_id))) {
      seeAlso.push(source);
    }
  }
  const p = provenanceStyles;
  return (
    <div className={`${p.claim} ${p.claim_team} ${p.compact}`}>
      <p className={p.text}>
        {index === null ? (
          claim.text
        ) : (
          <CodeText text={claim.text} index={index} mode={fromWorkbook ? "workbook" : "claim"} />
        )}
      </p>
      {!hideCitation && seeAlso.length > 0 && (
        <p className={p.citation}>
          See{" "}
          {seeAlso.map((source, position) => (
            <span key={source.id}>
              {position > 0 && "; "}
              <ExternalLink href={source.url}>{shortCitation(source)}</ExternalLink>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function dependencyTitle(dependsOn: boolean, neededFor: boolean): string {
  if (dependsOn && neededFor) {
    return "Depends on and needed for";
  }
  return dependsOn ? "Depends on" : "Needed for";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

// The one "Based on" line under the estimate.
function BasedOn({ item, sources }: { item: TimelineItem; sources: Record<string, SourceRef> }) {
  const { milestone, view } = item;

  if (view.barMode === "achieved") {
    // Nothing to show until the basis has text (see hasText)
    if (!milestone.achieved_in_basis || !hasText(milestone.achieved_in_basis)) {
      return null;
    }
    return (
      <div className={styles.basedOn}>
        <span className={styles.basedOnLabel}>Based on</span>
        <ClaimText claim={milestone.achieved_in_basis} sources={sources} variant="compact" quiet={DOSSIER_DEFAULT} />
      </div>
    );
  }

  if (milestone.estimate) {
    // Until the basis has text (see hasText), only who set the range shows.
    const showBasis = hasText(milestone.estimate.basis);
    return (
      <div className={styles.basedOn}>
        {showBasis && <span className={styles.basedOnLabel}>Based on</span>}
        {showBasis && (
          <ClaimText claim={milestone.estimate.basis} sources={sources} variant="compact" quiet={DOSSIER_DEFAULT} />
        )}
        <p className={styles.setBy}>
          Set by {milestone.estimate.set_by} on {formatIsoDate(milestone.estimate.set_on)}
        </p>
      </div>
    );
  }

  if (view.forecastCount > 0) {
    const names: string[] = [];
    for (const forecast of sortForecastsByWindow(view.forecasts)) {
      if (!names.includes(forecast.forecaster)) {
        names.push(forecast.forecaster);
      }
    }
    return (
      <div className={styles.basedOn}>
        <span className={styles.basedOnLabel}>Based on</span>
        <p className={styles.basedOnText}>
          {countLabel(view)}: {joinWords(names)}. We haven&apos;t set our own range.
        </p>
      </div>
    );
  }

  return null;
}

function EstimateBlock({ item }: { item: TimelineItem }) {
  const { milestone, view } = item;
  const estimate = milestone.estimate;

  if (estimate) {
    return (
      <div className={styles.estimate}>
        <p className={styles.bigYear}>
          <span className={styles.bigYearLabel}>Team range</span> {rangeText(estimate.earliest, estimate.latest)}
        </p>
        {estimate.latest === null && <p className={styles.muted}>The ribbon fades out on the right because the range has no end year.</p>}
        {milestone.confidence && (
          <p className={styles.confidence}>
            <span className="chip">Confidence · {enumLabel("Confidence", milestone.confidence)}</span>
            <span className={styles.muted}>{enumDescription("Confidence", milestone.confidence)}</span>
          </p>
        )}
        {view.disagreement.flagged && (
          <p className={styles.warnNote}>The forecasts below still disagree. The track draws each one as its own thin line next to this range.</p>
        )}
      </div>
    );
  }

  let note = "";
  if (view.barMode === "span" && view.bar) {
    // An open side means at least one forecast is open-ended there (see forecastSpan).
    let span = `The forecasts span ${rangeText(view.bar.start, view.bar.end)}`;
    if (view.bar.start === null) {
      span = `The forecasts run up to ${view.bar.end}, and at least one has no start year`;
    } else if (view.bar.end === null) {
      span = `The forecasts run from ${view.bar.start}, and at least one has no end year`;
    }
    note = `${span}. Our rule doesn't flag them as disagreeing, so the track shades those years with a faint ribbon.`;
  } else if (view.barMode === "whiskers" && view.forecastCount === 1) {
    note = "With only one forecast, the track draws it as a single thin line.";
  } else if (view.barMode === "whiskers" && view.disagreement.flagged) {
    note = "The forecasts disagree too much to sum up with one ribbon, so the track draws each as its own thin line.";
  } else if (view.barMode === "whiskers" && view.disagreement.ruleFlagged) {
    // The team overrode the flag, but forecasts the rule flags never get a ribbon (see estimates.ts).
    note =
      "Our rule won't put forecasts this far apart under one ribbon, because a ribbon would hide the gap. The track draws each as its own thin line, even though the team doesn't count the gap as a disagreement (see below).";
  } else if (view.barMode === "whiskers" && everyForecastSaysNever(view.forecasts)) {
    note = "Every forecast says it will never happen, so they show as crosses in the Never zone.";
  } else if (view.barMode === "whiskers") {
    // forecastSpan found no ribbon: between them, the forecasts are open-ended on both sides.
    note =
      "Taken together, these forecasts are open at both ends, and one ribbon over them would run the whole length of the track. Each is drawn as its own thin line instead.";
  }
  if (!note) {
    return null;
  }
  return <p className={styles.muted}>{note}</p>;
}

function ForecastLedger({ item, sources }: { item: TimelineItem; sources: Record<string, SourceRef> }) {
  const { view } = item;
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
        <caption className="visually-hidden">Forecasts for this milestone, one per row</caption>
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
                  {forecastClaimAddsSomething(forecast) && <span className={styles.forecastClaim}>{forecast.claim}</span>}
                </td>
                <td role="cell" data-label="Quote">
                  <q className={styles.quote}>{forecast.quote}</q>
                  <span className={styles.citation}>
                    <SourceCitation id={forecast.source_id} source={source} />
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
  // The team's reason for its call, and the note, are left out until they
  // have text (see hasText).
  let overrideBasis: Claim | null = null;
  if (d.overrideBasis !== null && hasText(d.overrideBasis)) {
    overrideBasis = d.overrideBasis;
  }
  let note: Claim | null = null;
  if (milestone.disagreement_note !== null && hasText(milestone.disagreement_note)) {
    note = milestone.disagreement_note;
  }

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
          At least two forecasts are more than {DISAGREEMENT_GAP_YEARS} years apart, or one says never while another
          gives a year. Who disagrees:
        </p>
        {reasonList}
      </>
    );
  } else if (d.flagged && d.decidedBy === "team") {
    heading = "Flagged by the team";
    body = (
      <>
        {overrideBasis && <ClaimText claim={overrideBasis} sources={sources} variant="compact" quiet={DOSSIER_DEFAULT} />}
        <p>{d.ruleFlagged ? "Our rule would have flagged it as well:" : "Our rule wouldn't have flagged it."}</p>
        {reasonList}
      </>
    );
  } else if (!d.flagged && d.decidedBy === "team") {
    heading = "Not flagged (team decision)";
    body = (
      <>
        {overrideBasis && <ClaimText claim={overrideBasis} sources={sources} variant="compact" quiet={DOSSIER_DEFAULT} />}
        {d.ruleFlagged ? (
          <>
            <p>Our rule would have flagged it:</p>
            {reasonList}
          </>
        ) : (
          <p>Our rule wouldn&apos;t have flagged it either.</p>
        )}
      </>
    );
  } else {
    heading = "No disagreement flagged";
    // Say only what the rule actually checked: it skips pairs from one forecaster in one source.
    let text = `We compared each pair of forecasts from different forecasters or sources. No two are more than ${DISAGREEMENT_GAP_YEARS} years apart, and none says never while another gives a year.`;
    if (everyForecastSaysNever(view.forecasts)) {
      text = "Every forecast says it will never happen, so the rule has nothing to flag.";
    } else if (allFromOneForecaster(view.forecasts)) {
      text = "These forecasts all come from one forecaster in one source, and the rule doesn't compare a forecaster with themselves.";
    }
    body = <p>{text}</p>;
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
          <ClaimText claim={note} sources={sources} variant="compact" quiet={DOSSIER_DEFAULT} />
        </div>
      )}
      <p className={styles.ruleLink}>
        <Link href="/methodology/#disagreement-rule">How the disagreement rule works</Link>
      </p>
    </div>
  );
}

// Milestones as chips. On the track a chip opens that milestone and moves the camera to it.
function DependencyChips({
  label,
  ids,
  itemsById,
  onSelectMilestone,
}: {
  // A small heading, used when both lists show under one section title.
  label: string | null;
  ids: string[];
  itemsById: Record<string, TimelineItem>;
  onSelectMilestone?: (id: string) => void;
}) {
  return (
    <div className={styles.dependencyGroup}>
      {label && <h4 className={styles.subTitle}>{label}</h4>}
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
            </>
          );
          return (
            <li key={id}>
              {onSelectMilestone ? (
                <button type="button" className={styles.dependency} onClick={() => onSelectMilestone(id)}>
                  {content}
                  <span className={styles.dependencyArrow} aria-hidden="true">
                    &rarr;
                  </span>
                </button>
              ) : (
                <span className={styles.dependency}>{content}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// A citation that links to its source, except for the made-up sources behind
// the worked examples, which have nowhere real to go.
function SourceCitation({ id, source }: { id: string; source: SourceRef | undefined }) {
  if (!source) {
    return <>{id}</>;
  }
  if (source.sample) {
    return <>{shortCitation(source)} (placeholder source)</>;
  }
  return <ExternalLink href={source.url}>{shortCitation(source)}</ExternalLink>;
}

// Each title links to the source itself, or with siteLinks to its entry in
// our source database, which links on to the source. The inline "See ..."
// citations above still go straight to the source.
function SourceList({ ids, sources, siteLinks }: { ids: string[]; sources: Record<string, SourceRef>; siteLinks: boolean }) {
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
        let title: ReactNode = (
          <ExternalLink href={source.url} className={styles.sourceTitle}>
            {source.title}
          </ExternalLink>
        );
        if (source.sample) {
          title = <span className={styles.sourceTitle}>{source.title}</span>;
        } else if (siteLinks) {
          title = (
            <Link href={`/sources/#${source.id}`} className={styles.sourceTitle}>
              {source.title}
            </Link>
          );
        }
        return (
          <li key={id} className={styles.sourceItem}>
            {title}
            <span className={styles.sourceMeta}>
              {shortCitation(source)}
              {source.sample && " · placeholder source"}
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
