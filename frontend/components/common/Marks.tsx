import styles from "./Marks.module.css";

// On records with sample: true (fictional placeholders for the prototype).
export function SampleChip({ label = "Sample" }: { label?: string }) {
  return <span className={`chip ${styles.sample}`}>{label}</span>;
}

// A tiny marker next to the name of a category that is still being decided.
export function DraftMark() {
  return (
    <span className={styles.draftMark} title="Draft category: the values may change">
      draft
    </span>
  );
}

// The larger badge used on the methodology page next to a category's name.
export function DraftBadge() {
  return <span className={`chip ${styles.draftBadge}`}>Draft</span>;
}
