import type { ReactNode } from "react";

import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import type { CandidateFlag, ReviewStatus, RunStatus } from "@/lib/adminTypes";

import styles from "./chips.module.css";
import { FLAG_DESCRIPTIONS, FLAG_LABELS, REVIEW_STATUS_LABELS, RUN_STATUS_LABELS } from "./labels";

export function StatusChip({ status }: { status: ReviewStatus }) {
  return <span className={`chip ${styles[`status_${status}`]}`}>{REVIEW_STATUS_LABELS[status]}</span>;
}

export function RunStatusChip({ status }: { status: RunStatus }) {
  const active = status === "running" || status === "queued";
  return (
    <span className={`chip ${styles[`run_${status}`]}`}>
      {active && <span className={styles.pulse} aria-hidden="true" />}
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

export function FlagChip({ flag }: { flag: CandidateFlag }) {
  return (
    <span className={`chip ${styles.flag}`} title={FLAG_DESCRIPTIONS[flag]}>
      {FLAG_LABELS[flag]}
    </span>
  );
}

// Something about a paper worth a second look, in the same ochre as the flags.
export function WarningChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${styles.flag}`} title={title}>
      {children}
    </span>
  );
}

// A value the AI suggested, in the dashed AI style.
export function AiChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${styles.ai}`} title={title}>
      <ProvenanceGlyph kind="ai" />
      {children}
    </span>
  );
}

export function PlainChip({ children }: { children: ReactNode }) {
  return <span className={`chip ${styles.plain}`}>{children}</span>;
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <span className={styles.chipRow}>{children}</span>;
}

// Whether code found the AI's quote in the title or abstract.
export function QuoteCheck({ found }: { found: boolean | undefined }) {
  if (found === true) {
    return (
      <span className={`${styles.check} ${styles.checkFound}`}>
        <span aria-hidden="true">✓</span> Quote found in the title or abstract
      </span>
    );
  }
  if (found === false) {
    return (
      <span className={`${styles.check} ${styles.checkMissing}`}>
        <span aria-hidden="true">✗</span> Quote not found in the title or abstract
      </span>
    );
  }
  return <span className={`${styles.check} ${styles.checkUnknown}`}>Quote not checked</span>;
}

// Whether a milestone or post goes on the public site at the next publish.
export function PublishStateChip({ published }: { published: boolean }) {
  return (
    <span className={`chip ${published ? styles.published : styles.draft}`}>{published ? "Published" : "Draft"}</span>
  );
}

// A fictional worked example. Samples never reach the public site.
export function SampleChip() {
  return (
    <span className={`chip ${styles.sample}`} title="A made-up worked example. The public site never shows samples.">
      Sample, never public
    </span>
  );
}
