import type { ReactNode } from "react";

import { GLOSSARY, type GlossaryName } from "./glossary";
import styles from "./Term.module.css";

interface TermProps {
  name: GlossaryName;
  children: ReactNode;
  // Replaces the glossary line, for a definition that depends on the page.
  definition?: string;
  // "end" lines the tip up with the word's right edge, for a term at the
  // right of a box that clips what overflows it (the technology page hero).
  align?: "start" | "end";
}

// A term with a dotted underline. Hovering, tapping or tabbing to it shows a
// one-line definition. No JavaScript needed: the definition is in the page,
// linked by aria-describedby, and CSS shows it on :hover and :focus. On a
// phone, TermDock (mounted once in the layout) moves or closes the docked tip.
// Elsewhere it keeps the tip under its word from running off the screen and,
// for a term that wraps, keeps it up a moment after the pointer leaves, and at
// any width it lets Escape hide the tip.
// Use it once per page, at the term's first use, so the id stays unique.
export function Term({ name, children, definition, align = "start" }: TermProps) {
  const tipId = `term-${name}`;
  const tipClass = align === "end" ? `${styles.tip} ${styles.tipEnd}` : styles.tip;
  return (
    <span className={styles.term}>
      <span className={styles.word} tabIndex={0} aria-describedby={tipId}>
        {children}
      </span>
      <span id={tipId} role="tooltip" className={tipClass}>
        {definition ?? GLOSSARY[name]}
      </span>
    </span>
  );
}

// Wraps the first occurrence of `phrase` in `text` with a Term. Content
// strings such as "Intelligence Curse case" stay as they are in the data.
export function TextWithTerm({
  text,
  phrase,
  name,
  definition,
}: {
  text: string;
  phrase: string;
  name: GlossaryName;
  definition?: string;
}) {
  const start = text.indexOf(phrase);
  if (start === -1) {
    return <>{text}</>;
  }
  const end = start + phrase.length;
  return (
    <>
      {text.slice(0, start)}
      <Term name={name} definition={definition}>
        {text.slice(start, end)}
      </Term>
      {text.slice(end)}
    </>
  );
}
