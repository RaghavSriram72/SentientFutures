"use client";

import { useState } from "react";

import styles from "./AuthorList.module.css";

// Up to this many authors are always shown in full. Longer lists show the
// first SHOWN_WHEN_SHORTENED names and a button for the rest.
const MAX_FULL_LIST = 5;
const SHOWN_WHEN_SHORTENED = 4;

// The byline's author names. Some sources list fifteen authors, which would
// push the summary off the card, so long lists start shortened.
export function AuthorList({ authors }: { authors: string[] }) {
  const [expanded, setExpanded] = useState(false);

  if (authors.length === 0) {
    return <span className={styles.unknown}>Authors not listed</span>;
  }

  const fullList = authors.join(", ");
  if (authors.length <= MAX_FULL_LIST) {
    return <span>{fullList}</span>;
  }

  if (expanded) {
    return (
      <span>
        {fullList}{" "}
        <button type="button" className={styles.toggle} aria-expanded="true" onClick={() => setExpanded(false)}>
          Show fewer
        </button>
      </span>
    );
  }

  const shown: string[] = [];
  for (let i = 0; i < SHOWN_WHEN_SHORTENED; i++) {
    shown.push(authors[i]);
  }
  const hiddenCount = authors.length - SHOWN_WHEN_SHORTENED;

  // A printout can't be clicked, so it gets the full list in place of the
  // shortened one and its button. The button keeps the same place as in the
  // expanded list above, so React reuses it and keyboard focus stays on it.
  return (
    <span title={fullList}>
      <span className={styles.shortened}>{shown.join(", ")}</span>{" "}
      <button type="button" className={styles.toggle} aria-expanded="false" onClick={() => setExpanded(true)}>
        and {hiddenCount} others
      </button>
      <span className={styles.printedList}>{fullList}</span>
    </span>
  );
}
