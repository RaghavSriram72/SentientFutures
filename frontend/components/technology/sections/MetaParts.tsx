import styles from "./MetaParts.module.css";

// A short line of parts joined by " · ", such as "Severity high · Likelihood
// not assessable · Low confidence". Each part stays on one line, and a
// separator stays at the end of the part before it, so a wrapped line never
// starts with "·" or splits "Likelihood" from its value.
export function MetaParts({ parts, className }: { parts: string[]; className?: string }) {
  return (
    <span className={className}>
      {parts.map((part, position) => (
        <span key={part}>
          <span className={styles.part}>
            {part}
            {position < parts.length - 1 && " ·"}
          </span>
          {position < parts.length - 1 && " "}
        </span>
      ))}
    </span>
  );
}
