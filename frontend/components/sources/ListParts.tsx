"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent } from "react";

import styles from "./SourceDatabase.module.css";

// Calls onChange after each render, which checks the address. A link or Back
// that stays on the page doesn't remount the list, but it changes the
// router's address, and useSearchParams renders this again whenever that
// changes, the hash included. So a link that only drops the hash, like
// /sources/#s02 to /sources/, is noticed too. Renders nothing. Wrap it in its
// own Suspense boundary, so the static export still prerenders the list.
export function AddressWatcher({ onChange }: { onChange: () => void }) {
  // Only read so this renders again when the address changes.
  useSearchParams();
  const notify = useEffectEvent(onChange);

  useEffect(() => {
    notify();
  });

  return null;
}

// The magnifier inside the search box.
export function SearchIcon() {
  return (
    <svg className={styles.searchIcon} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// One select that is filtering: the select's label and the picked option's.
export interface FilterChip {
  key: string;
  filter: string;
  value: string;
}

// Phones only: the filters in use, listed under the folded "Filters" button,
// so a filtered list says what it is filtered to without opening the panel.
// Each one is a button that turns its filter off. Wider screens show the
// selects themselves, so the stylesheet hides this there.
export function ActiveFilterChips({ chips, onRemove }: { chips: FilterChip[]; onRemove: (key: string) => void }) {
  if (chips.length === 0) {
    return null;
  }
  return (
    <ul className={styles.chips}>
      {chips.map((chip) => (
        <li key={chip.key}>
          <button type="button" className={styles.chip} onClick={() => onRemove(chip.key)}>
            <span className="visually-hidden">Remove filter: </span>
            <span className={styles.chipText}>
              <span className={styles.chipFilter}>{chip.filter}</span>
              <span className={styles.chipValue}>{chip.value}</span>
            </span>
            <svg className={styles.chipIcon} viewBox="0 0 12 12" aria-hidden="true">
              <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}
