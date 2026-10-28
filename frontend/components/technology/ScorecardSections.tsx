import type { ReactNode } from "react";

import { TextWithTerm } from "@/components/glossary/Term";
import { ClaimText } from "@/components/provenance/ClaimText";
import type { SourceRef } from "@/lib/sources";
import type {
  ArtificialMindsAssessment,
  Assessment,
  Claim,
  Problem,
  Provenance,
  Scope,
  WelfareGovernance,
} from "@/lib/types";

import { ConfidenceMeter, RatingChip } from "./Scorecard";
import styles from "./ScorecardSections.module.css";

// The sections of the team's populated scorecard (scorecard v0.1, sections 1
// to 6). TechnologyPageView decides which ones a page has and in what order.
// Every component takes `quiet`, the page's default provenance, so claims of
// that kind show only their glyph.

type Sources = Record<string, SourceRef>;

interface SheetItem {
  label: string;
  value: ReactNode;
  wide?: boolean; // spans both columns in a two-column sheet
}

// A ruled definition list on a paper card, like the spec sheet at the back of
// a manual. Used for the scope and for welfare and governance. With
// columns={2} the rows pair up side by side on wide screens.
function SpecSheet({
  title,
  note,
  items,
  columns = 1,
}: {
  title: string;
  note?: string;
  items: SheetItem[];
  columns?: 1 | 2;
}) {
  const listClass = columns === 2 ? styles.sheetListTwo : "";
  return (
    <div className={`paper ${styles.sheet}`}>
      <div className={styles.sheetHead}>
        <span>{title}</span>
        {note && <span>{note}</span>}
      </div>
      <dl className={listClass}>
        {items.map((item) => (
          <div key={item.label} className={item.wide ? `${styles.sheetRow} ${styles.sheetRowWide}` : styles.sheetRow}>
            <dt className={styles.sheetLabel}>{item.label}</dt>
            <dd className={styles.sheetValue}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function problemText(problem: Problem): string {
  if (problem === "alignment") {
    return "Alignment";
  }
  if (problem === "intelligence_curse") {
    return "The Intelligence Curse";
  }
  return "Both alignment and the Intelligence Curse";
}

interface ScopeSheetProps {
  scope: Scope;
  shortName: string;
  sources: Sources;
  quiet?: Provenance;
}

export function ScopeSheet({ scope, shortName, sources, quiet }: ScopeSheetProps) {
  function claim(value: Claim) {
    return <ClaimText claim={value} sources={sources} variant="compact" quiet={quiet} />;
  }
  return (
    <SpecSheet
      title={`Scope · ${shortName}`}
      items={[
        { label: "Intervention", value: claim(scope.intervention) },
        { label: "Deployment scenario", value: claim(scope.deployment_scenario) },
        { label: "Who it affects", value: claim(scope.affected_groups) },
        { label: "Time horizon", value: claim(scope.time_horizon) },
        { label: "Compared with", value: claim(scope.comparator) },
        { label: "Claims to address", value: <p className={styles.plainValue}>{problemText(scope.problem)}</p> },
      ]}
    />
  );
}

// The theory of change as numbered steps joined by a rule.
export function CausalChain({ steps, sources, quiet }: { steps: Claim[]; sources: Sources; quiet?: Provenance }) {
  return (
    <ol className={styles.chain}>
      {steps.map((step, index) => (
        <li key={index} className={`${styles.chainStep} reveal`}>
          <span className={styles.chainNumber} aria-hidden="true">
            {index + 1}
          </span>
          <div className={styles.chainClaim}>
            <ClaimText claim={step} sources={sources} quiet={quiet} />
          </div>
        </li>
      ))}
    </ol>
  );
}

interface AssessmentViewProps {
  assessment: Assessment;
  // "The alignment problem it targets" or "The mechanism it claims"
  mechanismLabel: string;
  sources: Sources;
  quiet?: Provenance;
  // The scorecard row that gives the reason for this rating. The reason
  // lives there only, so it isn't printed twice.
  whyHref: string;
  whyLabel: string;
  // Set on the first assessment on the page, so "comparator" is defined
  // where a reader first meets it.
  comparatorDefinition?: string;
}

// One evaluative section (alignment or the Intelligence Curse): what it
// targets, the scorecard's questions with our answers, the rating with a link
// to its reason, and the open question that would settle it.
export function AssessmentView({
  assessment,
  mechanismLabel,
  sources,
  quiet,
  whyHref,
  whyLabel,
  comparatorDefinition,
}: AssessmentViewProps) {
  return (
    <div className={styles.assessment}>
      <div className={styles.mechanism}>
        <p className={styles.label}>{mechanismLabel}</p>
        <ClaimText claim={assessment.mechanism} sources={sources} quiet={quiet} />
      </div>

      {assessment.questions.length > 0 && (
        <ol className={styles.qaList}>
          {assessment.questions.map((item, index) => (
            <li key={index} className={styles.qaItem}>
              <span className={styles.qaMark} aria-hidden="true">
                Q{index + 1}
              </span>
              <div className={styles.qaBody}>
                <p className={styles.question}>
                  {comparatorDefinition ? (
                    <TextWithTerm
                      text={item.question}
                      phrase="comparator"
                      name="comparator"
                      definition={comparatorDefinition}
                    />
                  ) : (
                    item.question
                  )}
                </p>
                <ClaimText claim={item.answer} sources={sources} quiet={quiet} />
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className={`paper ${styles.verdict}`}>
        <dl className={styles.verdictFacts}>
          <div>
            <dt className={styles.label}>Rating</dt>
            <dd>
              <RatingChip scale="case" rating={assessment.rating} unclearReason={assessment.unclear_reason} />
            </dd>
          </div>
          <div>
            <dt className={styles.label}>Confidence</dt>
            <dd>
              <ConfidenceMeter confidence={assessment.confidence} />
            </dd>
          </div>
        </dl>
        <a href={whyHref} className={styles.whyLink}>
          Why: {whyLabel}
        </a>
      </div>

      <div className={styles.decisive}>
        <p className={styles.label}>Decisive open question</p>
        <div className={styles.decisiveClaim}>
          <ClaimText claim={assessment.decisive_question} sources={sources} quiet={quiet} />
        </div>
      </div>
    </div>
  );
}

export function MindsGrid({
  minds,
  sources,
  quiet,
}: {
  minds: ArtificialMindsAssessment;
  sources: Sources;
  quiet?: Provenance;
}) {
  const items = [
    { label: "Consciousness", claim: minds.consciousness },
    { label: "Moral status", claim: minds.moral_status },
    { label: "Identity", claim: minds.identity },
    { label: "Welfare", claim: minds.welfare },
  ];
  return (
    <dl className={styles.minds}>
      {items.map((item) => (
        <div key={item.label} className={`paper ${styles.mindCard}`}>
          <dt className={styles.mindLabel}>{item.label}</dt>
          <dd>
            <ClaimText claim={item.claim} sources={sources} quiet={quiet} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function WelfareSheet({
  welfare,
  shortName,
  sources,
  quiet,
}: {
  welfare: WelfareGovernance;
  shortName: string;
  sources: Sources;
  quiet?: Provenance;
}) {
  function claim(value: Claim) {
    return <ClaimText claim={value} sources={sources} variant="compact" quiet={quiet} />;
  }
  return (
    <SpecSheet
      title={`Welfare and governance · ${shortName}`}
      columns={2}
      items={[
        { label: "Who could be harmed", value: claim(welfare.exposed) },
        { label: "Possible harms", value: claim(welfare.harms) },
        { label: "Severity and reversibility", value: claim(welfare.severity) },
        { label: "Detectability and remedies", value: claim(welfare.detectability) },
        { label: "Control, oversight and exit", value: claim(welfare.control) },
        { label: "Confidence", value: <ConfidenceMeter confidence={welfare.confidence} /> },
        { label: "Basis", value: claim(welfare.rationale), wide: true },
      ]}
    />
  );
}

// The primary evidence gap from the synopsis, set under the scorecard.
export function EvidenceGap({ claim, sources, quiet }: { claim: Claim; sources: Sources; quiet?: Provenance }) {
  return (
    <div className={styles.gap}>
      <p className={`${styles.label} ${styles.gapLabel}`}>Main gap in the evidence</p>
      <div className={styles.gapClaim}>
        <ClaimText claim={claim} sources={sources} quiet={quiet} />
      </div>
    </div>
  );
}
