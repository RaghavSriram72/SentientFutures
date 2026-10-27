import { Fragment, type ReactNode } from "react";

// Headlines in content files mark their one italic phrase with *asterisks*,
// like TechnologyPage.headline: "Why the timeline shows *every* forecast".
export function EmphasisText({ text }: { text: string }) {
  const parts = text.split("*");
  const nodes: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "") {
      continue;
    }
    // Odd pieces sat between a pair of asterisks.
    if (i % 2 === 1) {
      nodes.push(<em key={i}>{parts[i]}</em>);
    } else {
      nodes.push(<Fragment key={i}>{parts[i]}</Fragment>);
    }
  }
  return <>{nodes}</>;
}

// The same headline without the asterisks, for <title> and other plain text.
export function stripEmphasis(text: string): string {
  return text.replaceAll("*", "");
}
