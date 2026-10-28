import type { Provenance } from "@/lib/types";

import { ProvenanceGlyph } from "./ProvenanceTag";
import styles from "./Provenance.module.css";

const DEFAULT_TEXT: Record<Provenance, string> = {
  source: "From the cited sources unless marked",
  team: "The team's read unless marked",
  ai: "AI-suggested and not yet reviewed, unless marked",
  unclear: "Unclear unless marked",
};

// The one line at the top of a section that names its default kind. Claims of
// that kind then pass `quiet` and show only their glyph.
export function DefaultMark({ kind }: { kind: Provenance }) {
  return (
    <p className={`${styles.defaultMark} ${styles[`mark_${kind}`]}`}>
      <ProvenanceGlyph kind={kind} />
      <span>{DEFAULT_TEXT[kind]}</span>
    </p>
  );
}
