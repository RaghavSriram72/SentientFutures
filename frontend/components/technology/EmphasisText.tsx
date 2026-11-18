import { Fragment, type ReactNode } from "react";

import styles from "./EmphasisText.module.css";

// Headlines in content mark their one italic phrase with asterisks:
//   "What if the first digital minds *were ours*?"
// becomes  What if the first digital minds <em>were ours</em>?
// Text between an odd-numbered pair of asterisks is the emphasis.
// Two line-break rules keep a wrapped headline readable, without changing a
// word: a hyphenated word ("brain-computer") never breaks at its hyphen, and
// a last word of one or two letters in the emphasis ("neuromorphic AI")
// stays on the line of the word before it.
export function EmphasisText({ text }: { text: string }) {
  const parts = text.split("*");
  const nodes: ReactNode[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === "") {
      continue;
    }
    const isEmphasis = index % 2 === 1;
    if (isEmphasis) {
      nodes.push(<em key={index}>{keepHyphenatedWordsWhole(glueShortLastWord(part))}</em>);
    } else {
      nodes.push(<Fragment key={index}>{keepHyphenatedWordsWhole(part)}</Fragment>);
    }
  }
  return <>{nodes}</>;
}

// "neuromorphic AI" -> "neuromorphic AI" joined by a no-break space, so the
// short last word can't start a line on its own.
function glueShortLastWord(text: string): string {
  return text.replace(/\s(\S{1,2})$/, " $1");
}

// Each hyphenated word goes in a span that doesn't wrap, so a line never
// ends on its hyphen ("brain-" / "computer").
function keepHyphenatedWordsWhole(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // With a capture group, split puts the hyphenated words at odd indexes.
  const pieces = text.split(/(\S+-\S+)/);
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index];
    if (piece === "") {
      continue;
    }
    const isHyphenated = index % 2 === 1;
    if (isHyphenated) {
      nodes.push(
        <span key={index} className={styles.unbroken}>
          {piece}
        </span>,
      );
    } else {
      nodes.push(<Fragment key={index}>{piece}</Fragment>);
    }
  }
  return nodes;
}
