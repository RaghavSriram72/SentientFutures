import type { ReactNode } from "react";

import { enumValues, isDraftEnum, type EnumName } from "@/lib/enums";

import { DraftBadge } from "./Marks";
import styles from "./EnumDefinitions.module.css";

// A titled set of values, such as the milestone categories of one type.
export interface EnumGroup {
  id: string;
  title: ReactNode;
  values: string[];
}

interface EnumDefinitionsProps {
  name: EnumName;
  title: string;
  note?: string;
  // Folded into a <details> that shows only the title until it's opened.
  collapsible?: boolean;
  // Splits the values into titled groups, in the order given. Values in no
  // group come last, so a value added to enums.py later still shows up.
  groups?: EnumGroup[];
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

interface GroupRows {
  group: EnumGroup;
  rows: DefinitionRow[];
}

// Each group's rows in the group's order, then the values in no group. Every
// value gets a row of its own here, even when the descriptions match. A group
// with none of the category's values is left out.
function groupedRows(name: EnumName, groups: EnumGroup[]): { grouped: GroupRows[]; ungrouped: DefinitionRow[] } {
  const values = enumValues(name);
  const placed = new Set<string>();
  const grouped: GroupRows[] = [];
  for (const group of groups) {
    const rows: DefinitionRow[] = [];
    for (const value of group.values) {
      for (const info of values) {
        if (info.value === value) {
          rows.push({ label: info.label, description: info.description });
          placed.add(info.value);
        }
      }
    }
    if (rows.length > 0) {
      grouped.push({ group, rows });
    }
  }
  const ungrouped: DefinitionRow[] = [];
  for (const info of values) {
    if (!placed.has(info.value)) {
      ungrouped.push({ label: info.label, description: info.description });
    }
  }
  return { grouped, ungrouped };
}

function DefinitionList({ rows }: { rows: DefinitionRow[] }) {
  return (
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
}

// The values under their group titles. Each group is a role="group" named by
// its title, which is a paragraph and not a heading, so a screen reader's
// list of headings never shows a bare "Technical".
function GroupedDefinitions({ name, groups }: { name: EnumName; groups: EnumGroup[] }) {
  const { grouped, ungrouped } = groupedRows(name, groups);
  return (
    <div className={styles.groups}>
      {grouped.map(({ group, rows }) => {
        const titleId = `category-${name}-${group.id}`;
        return (
          <div key={group.id} role="group" aria-labelledby={titleId} className={styles.group}>
            <p id={titleId} className={styles.groupTitle}>
              {group.title}
            </p>
            <DefinitionList rows={rows} />
          </div>
        );
      })}
      {ungrouped.length > 0 && <DefinitionList rows={ungrouped} />}
    </div>
  );
}

// One category from the shared enums.json as a ruled definition list:
// its name and an optional note on the left, each value and its meaning on the right.
export function EnumDefinitions({ name, title, note, collapsible = false, groups }: EnumDefinitionsProps) {
  const headingId = `category-${name}`;
  const isDraft = isDraftEnum(name);

  const values = groups ? (
    <GroupedDefinitions name={name} groups={groups} />
  ) : (
    <DefinitionList rows={definitionRows(name)} />
  );

  if (collapsible) {
    // A link to a value inside (such as #category-MilestoneCategory-technical)
    // makes the browser open this fold before React starts up, so the page no
    // longer matches the server HTML, which has it closed. React never sets
    // `open` here, so the open fold is fine: suppressHydrationWarning only
    // stops the dev warning about that one attribute.
    return (
      <details
        className={`${styles.block} ${styles.collapsible} ${isDraft ? styles.isDraft : ""}`}
        suppressHydrationWarning
      >
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
