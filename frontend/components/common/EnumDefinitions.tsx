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
  note?: ReactNode;
  // Folded into a <details> that shows only the title until it's opened.
  collapsible?: boolean;
  // Splits the values into titled groups, in the order given. Values in no
  // group come last, so a value added to enums.py later still shows up.
  groups?: EnumGroup[];
  // Meanings to show instead of the ones in enums.json, keyed by value, such
  // as the workbook Codebook's own definitions. Values left out keep theirs.
  descriptions?: Record<string, string>;
  // A line under the values, such as where the meanings come from.
  footer?: ReactNode;
}

interface DefinitionRow {
  label: string;
  description: string;
}

type Descriptions = Record<string, string> | undefined;

// A value's meaning: the one passed in when there is one, else enums.json's.
function describe(info: { value: string; description: string }, descriptions: Descriptions): string {
  return descriptions?.[info.value] ?? info.description;
}

// One row per value. When every value has the same description (the time
// horizons are all "Definition to be agreed.", and scales with no
// definitions have none at all), the labels share one row so the sentence
// isn't printed three times.
function definitionRows(name: EnumName, descriptions: Descriptions): DefinitionRow[] {
  const values = enumValues(name);
  let allSame = values.length > 1;
  for (const info of values) {
    if (describe(info, descriptions) !== describe(values[0], descriptions)) {
      allSame = false;
    }
  }
  if (allSame) {
    const labels: string[] = [];
    for (const info of values) {
      labels.push(info.label);
    }
    return [{ label: labels.join(", "), description: describe(values[0], descriptions) }];
  }
  const rows: DefinitionRow[] = [];
  for (const info of values) {
    rows.push({ label: info.label, description: describe(info, descriptions) });
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
function groupedRows(
  name: EnumName,
  groups: EnumGroup[],
  descriptions: Descriptions,
): { grouped: GroupRows[]; ungrouped: DefinitionRow[] } {
  const values = enumValues(name);
  const placed = new Set<string>();
  const grouped: GroupRows[] = [];
  for (const group of groups) {
    const rows: DefinitionRow[] = [];
    for (const value of group.values) {
      for (const info of values) {
        if (info.value === value) {
          rows.push({ label: info.label, description: describe(info, descriptions) });
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
      ungrouped.push({ label: info.label, description: describe(info, descriptions) });
    }
  }
  return { grouped, ungrouped };
}

// A row with no meaning to show (scales the workbook gives as plain labels)
// lets its labels use the full width instead of wrapping in the label column.
function DefinitionList({ rows }: { rows: DefinitionRow[] }) {
  return (
    <dl className={styles.values}>
      {rows.map((row) => (
        <div key={row.label} className={`${styles.row} ${row.description === "" ? styles.labelsOnly : ""}`}>
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
function GroupedDefinitions({
  name,
  groups,
  descriptions,
}: {
  name: EnumName;
  groups: EnumGroup[];
  descriptions: Descriptions;
}) {
  const { grouped, ungrouped } = groupedRows(name, groups, descriptions);
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
export function EnumDefinitions({
  name,
  title,
  note,
  collapsible = false,
  groups,
  descriptions,
  footer,
}: EnumDefinitionsProps) {
  const headingId = `category-${name}`;
  const isDraft = isDraftEnum(name);

  const list = groups ? (
    <GroupedDefinitions name={name} groups={groups} descriptions={descriptions} />
  ) : (
    <DefinitionList rows={definitionRows(name, descriptions)} />
  );
  // With a footer, the list and its footer share one box, so the layout
  // around them still sees one block of values.
  const values = footer ? (
    <div className={styles.withFooter}>
      {list}
      <p className={styles.footer}>{footer}</p>
    </div>
  ) : (
    list
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
