import { enumValues, isDraftEnum, type EnumName } from "@/lib/enums";

import { DraftBadge } from "./Marks";
import styles from "./EnumDefinitions.module.css";

interface EnumDefinitionsProps {
  name: EnumName;
  title: string;
  note?: string;
}

// One category from the shared enums.json as a ruled definition list:
// its name and an optional note on the left, each value and its meaning on the right.
export function EnumDefinitions({ name, title, note }: EnumDefinitionsProps) {
  const headingId = `category-${name}`;
  const isDraft = isDraftEnum(name);

  return (
    <section className={`${styles.block} ${isDraft ? styles.isDraft : ""}`} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h3 id={headingId} className={styles.title}>
          {title}
        </h3>
        {isDraft && <DraftBadge />}
        {note && <p className={styles.note}>{note}</p>}
      </div>
      <dl className={styles.values}>
        {enumValues(name).map((info) => (
          <div key={info.value} className={styles.row}>
            <dt className={styles.term}>
              <span className={styles.label}>{info.label}</span>
              <code className={styles.code}>{info.value}</code>
            </dt>
            <dd className={styles.desc}>{info.description}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// "EvidenceType" -> "Evidence type", for any category without a hand-written title.
export function enumTitleFromName(name: string): string {
  let title = "";
  for (let i = 0; i < name.length; i++) {
    const letter = name[i];
    const isCapital = letter >= "A" && letter <= "Z";
    if (i === 0) {
      title += letter;
    } else if (isCapital) {
      title += ` ${letter.toLowerCase()}`;
    } else {
      title += letter;
    }
  }
  return title;
}
