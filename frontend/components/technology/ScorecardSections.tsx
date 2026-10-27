import type { ReactNode } from "react";

import { ClaimList, ClaimText } from "@/components/provenance/ClaimText";
import type { SourceRef } from "@/lib/sources";
import type {
  ArtificialMindsAssessment,
  Assessment,
  Claim,
  Problem,
  Scope,
  WelfareGovernance,
} from "@/lib/types";

import { ConfidenceMeter, RatingChip } from "./Scorecard";
import styles from "./ScorecardSections.module.css";

// The sections of the team's populated scorecard (scorecard v0.1, sections 1
// to 6). TechnologyPageView decides which ones a page has and in what order.

type Sources = Record<string, SourceRef>;

interface SheetItem {
  label: string;
  value: ReactNode;
}

// A ruled definition list on a paper card, like the spec sheet at the back of
// a manual. Used for the scope and for welfare and governance.
function SpecSheet({ title, note, items }: { title: string; note?: string; items: SheetItem[] }) {
  return (
    <div className={`paper ${styles.sheet}`}>
      <div className={styles.sheetHead}>
        <span>{title}</span>
        {note && <span>{note}</span>}
      </div>
      <dl className={styles.sheetList}>
        {items.map((item) => (
          <div key={item.label} className={styles.sheetRow}>
            <dt className={styles.sheetLabel}>{item.label}</dt>
            <dd className={styles.sheetValue}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function problemText(problem: Problem): string {
  if (problem === "alignment") {
    return "Alignment";
  }
  if (problem === "intelligence_curse") {
    return "The Intelligence Curse";
  }
  return "Both alignment and the Intelligence Curse";
}

export function ScopeSheet({ scope, shortName, sources }: { scope: Scope; shortName: string; sources: Sources }) {
  return (
    <SpecSheet
      title={`Scope · ${shortName}`}
      note="Unrated"
      items={[
        { label: "Intervention", value: <ClaimText claim={scope.intervention} sources={sources} /> },
        { label: "Deployment scenario", value: <ClaimText claim={scope.deployment_scenario} sources={sources} /> },
        { label: "Who it affects", value: <ClaimText claim={scope.affected_groups} sources={sources} /> },
        { label: "Time horizon", value: <ClaimText claim={scope.time_horizon} sources={sources} /> },
        { label: "Compared with", value: <ClaimText claim={scope.comparator} sources={sources} /> },
        { label: "Claims to address", value: <p className={styles.plainValue}>{problemText(scope.problem)}</p> },
      ]}
    />
  );
}

// The theory of change as numbered steps joined by a rule.
export function CausalChain({ steps, sources }: { steps: Claim[]; sources: Sources }) {
  return (
    <ol className={styles.chain}>
      {steps.map((step, index) => (
        <li key={index} className={`${styles.chainStep} reveal`}>
          <span className={styles.chainNumber} aria-hidden="true">
            {index + 1}
          </span>
          <div className={styles.chainClaim}>
            <ClaimText claim={step} sources={sources} />
          </div>
        </li>
      ))}
    </ol>
  );
}

// The alternatives and counterarguments, set under the chain they push against.
export function ChainBreaks({
  claims,
  sources,
  afterChain,
}: {
  claims: Claim[];
  sources: Sources;
  afterChain: boolean;
}) {
  return (
    <div className={`${styles.breaks} reveal`}>
      <h3 className={styles.subTitle}>Where the chain could break</h3>
      <p className={styles.subNote}>
        {afterChain
          ? "Alternatives and counterarguments to the steps above."
          : "Alternatives and counterarguments to the proposal."}
      </p>
      <ClaimList claims={claims} sources={sources} />
    </div>
  );
}

interface AssessmentViewProps {
  assessment: Assessment;
  // "The alignment problem it targets" or "The mechanism it claims"
  mechanismLabel: string;
  sources: Sources;
}

// One evaluative section (alignment or the Intelligence Curse): what it
// targets, the scorecard's questions with our answers, the rating and why,
// and the open question that would settle it.
export function AssessmentView({ assessment, mechanismLabel, sources }: AssessmentViewProps) {
  return (
    <div className={styles.assessment}>
      <div className={`${styles.mechanism} reveal`}>
        <p className={styles.label}>{mechanismLabel}</p>
        <ClaimText claim={assessment.mechanism} sources={sources} />
      </div>

      {assessment.questions.length > 0 && (
        <ol className={styles.qaList}>
          {assessment.questions.map((item, index) => (
            <li key={index} className={`${styles.qaItem} reveal`}>
              <span className={styles.qaMark} aria-hidden="true">
                Q{index + 1}
              </span>
              <div className={styles.qaBody}>
                <p className={styles.question}>{item.question}</p>
                <ClaimText claim={item.answer} sources={sources} />
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className={`paper ${styles.verdict} reveal`}>
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
        <div className={styles.verdictReason}>
          <p className={styles.label}>Why this rating</p>
          <ClaimText claim={assessment.reason} sources={sources} />
        </div>
      </div>

      <div className={`${styles.decisive} reveal`}>
        <p className={styles.label}>Decisive open question</p>
        <div className={styles.decisiveClaim}>
          <ClaimText claim={assessment.decisive_question} sources={sources} />
        </div>
      </div>
    </div>
  );
}

export function MindsGrid({ minds, sources }: { minds: ArtificialMindsAssessment; sources: Sources }) {
  const items = [
    { label: "Consciousness", claim: minds.consciousness },
    { label: "Moral status", claim: minds.moral_status },
    { label: "Identity", claim: minds.identity },
    { label: "Welfare", claim: minds.welfare },
  ];
  return (
    <dl className={styles.minds}>
      {items.map((item) => (
        <div key={item.label} className={`paper ${styles.mindCard} reveal`}>
          <dt className={styles.mindLabel}>{item.label}</dt>
          <dd>
            <ClaimText claim={item.claim} sources={sources} />
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
}: {
  welfare: WelfareGovernance;
  shortName: string;
  sources: Sources;
}) {
  return (
    <SpecSheet
      title={`Welfare and governance · ${shortName}`}
      items={[
        { label: "Who could be harmed", value: <ClaimText claim={welfare.exposed} sources={sources} /> },
        { label: "Possible harms", value: <ClaimText claim={welfare.harms} sources={sources} /> },
        { label: "Severity and reversibility", value: <ClaimText claim={welfare.severity} sources={sources} /> },
        { label: "Detectability and remedies", value: <ClaimText claim={welfare.detectability} sources={sources} /> },
        { label: "Control, oversight and exit", value: <ClaimText claim={welfare.control} sources={sources} /> },
        { label: "Confidence", value: <ConfidenceMeter confidence={welfare.confidence} /> },
        { label: "Basis", value: <ClaimText claim={welfare.rationale} sources={sources} /> },
      ]}
    />
  );
}

// The primary evidence gap from the synopsis, closing the scorecard section.
export function EvidenceGap({ claim, sources }: { claim: Claim; sources: Sources }) {
  return (
    <div className={`${styles.gap} reveal`}>
      <p className={`${styles.label} ${styles.gapLabel}`}>Main gap in the evidence</p>
      <div className={styles.gapClaim}>
        <ClaimText claim={claim} sources={sources} />
      </div>
    </div>
  );
}
