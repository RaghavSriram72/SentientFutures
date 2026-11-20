import type { MilestoneTypeInfo } from "@/lib/enums";
import type { MilestoneType } from "@/lib/types";

import styles from "./TypeMark.module.css";

// A milestone's type (Technical, Deployment, or Welfare and governance) is
// always a glyph plus a word, drawn in ink and never as a color. Color on the
// timeline means the stage and nothing else. The glyphs are also shaped unlike
// the grape technology outlines and the four provenance marks, and copy never
// calls them "marks". No hooks, so server and client components can both use it.

interface TypeGlyphProps {
  type: MilestoneType;
  className?: string;
}

// A 12x12 outline in currentColor: a gear for Technical, a package cube for
// Deployment and a shield for Welfare and governance. Always aria-hidden: the
// type's name is written next to it. The width and height attributes are only
// a default size, and any CSS width and height replaces them.
export function TypeGlyph({ type, className }: TypeGlyphProps) {
  if (type === "technical") {
    // A ring with six teeth around a small hub. The hub keeps the gear from
    // reading as a plain circle, which is the WBE glyph on the same 3D card.
    return (
      <svg className={className} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <g fill="none" stroke="currentColor">
          <circle cx="6" cy="6" r="3.2" strokeWidth="1.3" />
          <circle cx="6" cy="6" r="1.1" strokeWidth="1.1" />
          <path
            d="M6 2.4V.7M9.12 4.2l1.47-.85M9.12 7.8l1.47.85M6 9.6v1.7M2.88 7.8l-1.47.85M2.88 4.2l-1.47-.85"
            strokeWidth="1.8"
          />
        </g>
      </svg>
    );
  }
  if (type === "deployment") {
    return (
      <svg className={className} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <path
          d="M6 1.3 10.6 3.8v4.4L6 10.7 1.4 8.2V3.8Z M1.4 3.8 6 6.3l4.6-2.5 M6 6.3v4.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // welfare_governance: a shield
  return (
    <svg className={className} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path
        d="M6 1.2 10.4 2.9v3.2c0 2.6-1.9 4.3-4.4 5.2C3.5 10.4 1.6 8.7 1.6 6.1V2.9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface TypeMarkProps {
  type: MilestoneTypeInfo;
  // mono: small monospace caps, for code lines, rows and headings.
  // plain: the surrounding font at weight 600, for the 3D cards.
  variant?: "mono" | "plain";
  // Screen readers hear "Type: Technical". Turn it off where the context
  // already says it is a type, such as a group title.
  announce?: boolean;
  className?: string;
}

// The glyph, then the type's name. A name that wraps hangs under its first
// word, not under the glyph.
export function TypeMark({ type, variant = "mono", announce = true, className }: TypeMarkProps) {
  const classNames = [styles.mark, variant === "plain" ? styles.plain : styles.mono];
  if (className) {
    classNames.push(className);
  }
  return (
    <span className={classNames.join(" ")}>
      <TypeGlyph type={type.value} className={styles.glyph} />
      <span className={styles.label}>
        {announce && <span className="visually-hidden">Type: </span>}
        {type.label}
      </span>
    </span>
  );
}
