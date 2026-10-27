import { enumDescription, enumLabel } from "@/lib/enums";
import type { ClaimDirection } from "@/lib/types";

import styles from "./ClaimDirectionChip.module.css";

export type DirectionTone = "for" | "against";

// The team's "Claim (+/-)" column: two directions argue the approach could
// help, two argue it won't or could make things worse.
export function directionTone(direction: ClaimDirection): DirectionTone {
  if (direction === "ai_alignment" || direction === "human_empowerment") {
    return "for";
  }
  return "against";
}

// A plus or minus in a ring. The shape carries the meaning, so the two still
// read apart without color. Decorative unless given a label.
export function DirectionGlyph({ tone, label }: { tone: DirectionTone; label?: string }) {
  const toneClass = tone === "for" ? styles.glyphFor : styles.glyphAgainst;
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <svg className={`${styles.glyph} ${toneClass}`} viewBox="0 0 12 12" {...a11y}>
      <circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M3.5 6h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {tone === "for" && <path d="M6 3.5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

export function ClaimDirectionChip({ direction }: { direction: ClaimDirection }) {
  const tone = directionTone(direction);
  const toneClass = tone === "for" ? styles.chipFor : styles.chipAgainst;
  return (
    <span className={`chip ${styles.chip} ${toneClass}`} title={enumDescription("ClaimDirection", direction)}>
      <DirectionGlyph tone={tone} />
      {enumLabel("ClaimDirection", direction)}
    </span>
  );
}
