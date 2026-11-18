import Link from "next/link";

import styles from "./Marks.module.css";

// On records with sample: true (fictional placeholders for the prototype).
export function SampleChip({ label = "Sample" }: { label?: string }) {
  return <span className={`chip ${styles.sample}`}>{label}</span>;
}

// A tiny marker next to the name of a category that is still being decided.
// It links to where the methodology explains drafts, since a touch screen
// can't show the title.
export function DraftMark() {
  return (
    <Link href="/methodology/#versions" className={styles.draftMark} title="Draft category: the values may change">
      draft
    </Link>
  );
}

// The larger badge used on the methodology page next to a category's name.
export function DraftBadge() {
  return <span className={`chip ${styles.draftBadge}`}>Draft</span>;
}
