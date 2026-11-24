import { Fragment, type ReactNode } from "react";

import { TypeGlyph } from "@/components/common/TypeMark";
import { enumDescription, enumLabel, enumValues, milestoneTypes } from "@/lib/enums";
import type { Provenance, Stage } from "@/lib/types";

import { ProvenanceTag } from "./ProvenanceTag";
import styles from "./Provenance.module.css";

// The team's own claims carry no mark, so the key leaves them out.
const PROVENANCE_ORDER: Provenance[] = ["source", "ai", "unclear"];

// The site-wide key for the marked kinds of content. Shown on the timeline,
// the sources page, technology pages and methodology.
//
// With placeholderTag, the full key ends with a card for the Placeholder tag
// a rating card's example tracker starts with (RatingCard's Tracker). It is a
// tag, not a mark, so it stays out of PROVENANCE_ORDER. The caller passes the
// tag (<SampleChip label="Placeholder" />), so this file doesn't load its
// styles on the home page, which imports StageLegend from here.
export function ProvenanceLegend({ compact = false, placeholderTag }: { compact?: boolean; placeholderTag?: ReactNode }) {
  if (compact) {
    return (
      <div className={styles.legendCompact} aria-label="What the marks mean">
        {PROVENANCE_ORDER.map((kind) => (
          <ProvenanceTag key={kind} kind={kind} plain />
        ))}
      </div>
    );
  }
  return (
    <div className={styles.legend} aria-label="What the marks mean">
      {PROVENANCE_ORDER.map((kind) => (
        <div key={kind} className={`${styles.legendItem} ${styles[`legendItem_${kind}`] ?? ""}`}>
          <ProvenanceTag kind={kind} plain />
          <p className={styles.legendDesc}>{enumDescription("Provenance", kind)}</p>
        </div>
      ))}
      {placeholderTag && (
        <div className={`${styles.legendItem} ${styles.legendItem_placeholder}`}>
          <span className={styles.legendTag}>{placeholderTag}</span>
          <p className={styles.legendDesc}>An example we haven&rsquo;t checked yet.</p>
        </div>
      )}
    </div>
  );
}

// Stage is the only thing color carries on the timeline. The numbers match
// the "Stage 2:" tags on the timeline and the Stage 1 to 3 cards on /methodology/.
export function StageLegend() {
  return (
    <ul className={styles.stageLegend} aria-label="Stages">
      {enumValues("Stage").map((info, index) => (
        <li key={info.value} className={styles.stageItem}>
          <span className={`${styles.stageSwatch} ${styles[`stage_${info.value as Stage}`]}`} aria-hidden="true" />
          {index + 1} {info.label}
        </li>
      ))}
    </ul>
  );
}

// A category's name, with any hyphenated word ("High-level") kept on one
// line. The browser would otherwise end a line after the hyphen, as in
// "High- / level fidelity".
function CategoryName({ name }: { name: string }) {
  // split() with a capture group keeps the hyphenated words, at the odd positions.
  const parts = name.split(/(\S+-\S+)/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className={styles.typeNoBreak}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

// The three milestone types and the categories in each, for the timeline's
// Key and /methodology/. The glyph column's width comes from
// --type-glyph-column, so the Key can line the glyphs up with its other marks.
//
// The categories read "Technical capability · High-level fidelity · ...", the
// same text as milestoneTypeCategoriesText. Each dot belongs to the category
// after it and hangs in the gap before it (see .typeDot), so a line never
// starts or ends with a dot: when a category wraps onto a new line, its dot
// falls outside the text and is clipped.
export function TypeLegend({ className }: { className?: string }) {
  const listClassName = className ? `${styles.typeLegend} ${className}` : styles.typeLegend;
  return (
    <ul className={listClassName} aria-label="Milestone types">
      {milestoneTypes().map((info) => (
        <li key={info.value} className={styles.typeItem}>
          <TypeGlyph type={info.value} className={styles.typeGlyph} />
          <span className={styles.typeText}>
            <b className={styles.typeName}>{info.label}.</b>
            {info.categories.map((category, index) => (
              <Fragment key={category}>
                {/* A plain space after the type's name, and the dot's wider gap between categories */}
                {index === 0 ? " " : <span className={styles.typeGap}> </span>}
                <span className={styles.typeCategory}>
                  {index > 0 && <span className={styles.typeDot}>· </span>}
                  <CategoryName name={enumLabel("MilestoneCategory", category)} />
                </span>
              </Fragment>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
