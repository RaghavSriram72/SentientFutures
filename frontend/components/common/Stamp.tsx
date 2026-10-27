import styles from "./Stamp.module.css";

// The rubber-stamp badge for disagreement ("SOURCES DISAGREE"). Red is reserved
// for this one signal, and the words always say it, so color is never the only cue.
export function Stamp({ children = "Sources disagree", size = "md" }: { children?: string; size?: "sm" | "md" }) {
  return <span className={`${styles.stamp} ${size === "sm" ? styles.small : ""}`}>{children}</span>;
}
