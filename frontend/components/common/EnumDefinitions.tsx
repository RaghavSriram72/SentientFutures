import { enumValues, isDraftEnum, type EnumName } from "@/lib/enums";

import { DraftBadge } from "./Marks";
import styles from "./EnumDefinitions.module.css";

interface EnumDefinitionsProps {
  name: EnumName;
  title: string;
  note?: string;
  // Folded into a <details> that shows only the title until it's opened.
  collapsible?: boolean;
}

interface DefinitionRow {
  label: string;
  description: string;
}

// One row per value. When every value has the same description (the time
// horizons are all "Definition to be agreed."), the labels share one row so
// the sentence isn't printed three times.
function definitionRows(name: EnumName): DefinitionRow[] {
  const values = enumValues(name);
  let allSame = values.length > 1;
  for (const info of values) {
    if (info.description !== values[0].description) {
      allSame = false;
    }
  }
  if (allSame) {
    const labels: string[] = [];
    for (const info of values) {
      labels.push(info.label);
    }
    return [{ label: labels.join(", "), description: values[0].description }];
  }
  const rows: DefinitionRow[] = [];
  for (const info of values) {
    rows.push({ label: info.label, description: info.description });
  }
  return rows;
}

// One category from the shared enums.json as a ruled definition list:
// its name and an optional note on the left, each value and its meaning on the right.
export function EnumDefinitions({ name, title, note, collapsible = false }: EnumDefinitionsProps) {
  const headingId = `category-${name}`;
  const isDraft = isDraftEnum(name);
  const rows = definitionRows(name);

  const values = (
    <dl className={styles.values}>
      {rows.map((row) => (
        <div key={row.label} className={styles.row}>
          <dt className={styles.term}>
            <span className={styles.label}>{row.label}</span>
          </dt>
          <dd className={styles.desc}>{row.description}</dd>
        </div>
      ))}
    </dl>
  );

  if (collapsible) {
    return (
      <details className={`${styles.block} ${styles.collapsible} ${isDraft ? styles.isDraft : ""}`}>
        <summary className={styles.summary}>
          <span id={headingId} className={styles.title}>
            {title}
          </span>
          {isDraft && <DraftBadge />}
          <span className={styles.count}>{enumValues(name).length} values</span>
          <span className={styles.chevron} aria-hidden="true" />
        </summary>
        <div className={styles.collapsibleBody}>
          {note && <p className={styles.note}>{note}</p>}
          {values}
        </div>
      </details>
    );
  }

  return (
    <section className={`${styles.block} ${isDraft ? styles.isDraft : ""}`} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h3 id={headingId} className={styles.title}>
          {title}
        </h3>
        {isDraft && <DraftBadge />}
        {note && <p className={styles.note}>{note}</p>}
      </div>
      {values}
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
