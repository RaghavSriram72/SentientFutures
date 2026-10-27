import { enumLabel } from "@/lib/enums";
import type { Provenance, UnclearReason } from "@/lib/types";

import styles from "./Provenance.module.css";

interface ProvenanceTagProps {
  kind: Provenance;
  reviewedBy?: string | null;
  unclearReason?: UnclearReason | null;
  // Legends show just the kind's name, without review or reason details.
  plain?: boolean;
}

// The small monospace label that names a claim's provenance. Each kind has its
// own glyph and line style, so the four are distinct without relying on color.
export function ProvenanceTag({ kind, reviewedBy, unclearReason, plain = false }: ProvenanceTagProps) {
  let label = enumLabel("Provenance", kind);
  if (plain) {
    // no details
  } else if (kind === "ai") {
    label = reviewedBy ? `${label} · checked by ${reviewedBy}` : `${label} · not yet reviewed`;
  }
  if (!plain && kind === "unclear" && unclearReason) {
    label = `${label} · ${enumLabel("UnclearReason", unclearReason)}`;
  }

  return (
    <span className={`${styles.tag} ${styles[`tag_${kind}`]}`}>
      <ProvenanceGlyph kind={kind} />
      {label}
    </span>
  );
}

export function ProvenanceGlyph({ kind }: { kind: Provenance }) {
  if (kind === "source") {
    // A pair of quote marks
    return (
      <svg className={styles.glyph} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 7.5c0-2 1-3.5 2.8-4.3l.4.7C4.2 4.5 3.7 5.3 3.6 6H5v3H2V7.5Zm5 0c0-2 1-3.5 2.8-4.3l.4.7C9.2 4.5 8.7 5.3 8.6 6H10v3H7V7.5Z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "team") {
    // A solid diamond, like a margin mark
    return (
      <svg className={styles.glyph} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1.5 10.5 6 6 10.5 1.5 6Z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "ai") {
    // A dashed square
    return (
      <svg className={styles.glyph} viewBox="0 0 12 12" aria-hidden="true">
        <rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />
      </svg>
    );
  }
  // unclear: a hatched circle
  return (
    <svg className={styles.glyph} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <g stroke="currentColor" strokeWidth="1">
        <line x1="2.4" y1="6.4" x2="6.4" y2="2.4" />
        <line x1="3" y1="9" x2="9" y2="3" />
        <line x1="5.6" y1="9.6" x2="9.6" y2="5.6" />
      </g>
    </svg>
  );
}
