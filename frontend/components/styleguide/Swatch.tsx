import styles from "./Swatch.module.css";

interface SwatchProps {
  token: string; // "--grape"
  value: string; // printed only
  label: string;
  note?: string;
}

// One color token: the chip paints itself with the live CSS variable.
export function Swatch({ token, value, label, note }: SwatchProps) {
  return (
    <li className={styles.swatch}>
      <span className={styles.chip} style={{ background: `var(${token})` }} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
      <code className={styles.code}>{token}</code>
      <code className={styles.code}>{value}</code>
      {note && <span className={styles.note}>{note}</span>}
    </li>
  );
}
