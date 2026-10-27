import { Fragment, type ReactNode } from "react";

// Headlines in content mark their one italic phrase with asterisks:
//   "What if the first digital minds *were ours*?"
// becomes  What if the first digital minds <em>were ours</em>?
// Text between an odd-numbered pair of asterisks is the emphasis.
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
      nodes.push(<em key={index}>{part}</em>);
    } else {
      nodes.push(<Fragment key={index}>{part}</Fragment>);
    }
  }
  return <>{nodes}</>;
}
