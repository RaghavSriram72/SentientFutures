import type { Provenance } from "@/lib/types";

import { ProvenanceGlyph } from "./ProvenanceTag";
import styles from "./Provenance.module.css";

const DEFAULT_TEXT: Record<Provenance, string> = {
  source: "From the cited sources unless marked",
  team: "",
  ai: "AI-suggested, not yet reviewed",
  unclear: "Unclear unless marked",
};

// The one line at the top of a section that names its default kind. Claims of
// that kind then pass `quiet` and show only their glyph. The team's claims
// carry no mark, so a team section gets no line either.
export function DefaultMark({ kind }: { kind: Provenance }) {
  if (kind === "team") {
    return null;
  }
  return (
    <p className={`${styles.defaultMark} ${styles[`mark_${kind}`]}`}>
      <ProvenanceGlyph kind={kind} />
      <span>{DEFAULT_TEXT[kind]}</span>
    </p>
  );
}
