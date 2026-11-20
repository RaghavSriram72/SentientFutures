// How the methodology page shows the workbook's Codebook. Pure functions with
// no React and no data loading, so tests/codebookModel.test.ts can run them.
// Nothing here rewords a cell: rows keep their sheet order and their text.
import type { CodebookRow } from "@/lib/types";

// A run of rows next to each other in the sheet that share a Type. A type that
// comes back later in the sheet (the last Scenario row, BCI-X, sits after the
// Comparator rows) starts a run of its own, so no row ever moves.
export interface CodebookRun {
  // The fold's id: "codebook-scenario", then "codebook-scenario-2" for a
  // second run of the same type, so every fold can be linked to.
  id: string;
  type: string;
  // The fold's name: the Type, then for a later run of a type already seen,
  // the Type and its first code ("Scenario · BCI-X"), so two folds never
  // share a name.
  title: string;
  rows: CodebookRow[];
  // The Family cell when every row in the run has the same one, so the page
  // can show it once instead of on every row. null when they differ.
  family: string | null;
}

// "Alignment problem" -> "alignment-problem"
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function codebookRuns(rows: CodebookRow[]): CodebookRun[] {
  const runs: CodebookRun[] = [];
  const timesUsed: Record<string, number> = {};
  for (const row of rows) {
    const last = runs[runs.length - 1];
    if (last && last.type === row.type) {
      last.rows.push(row);
      continue;
    }
    const base = `codebook-${slug(row.type)}`;
    timesUsed[base] = (timesUsed[base] ?? 0) + 1;
    const first = timesUsed[base] === 1;
    const id = first ? base : `${base}-${timesUsed[base]}`;
    const title = first ? row.type : `${row.type} · ${row.code}`;
    runs.push({ id, type: row.type, title, rows: [row], family: null });
  }
  for (const run of runs) {
    let shared = true;
    for (const row of run.rows) {
      if (row.family !== run.rows[0].family) {
        shared = false;
      }
    }
    run.family = shared ? run.rows[0].family : null;
  }
  return runs;
}

// One definition that names several values in turn, like the Confidence row
// ("High: ... Medium: ... Low: ..."), cut at its own "<label>:" markers. Each
// piece is the text after its marker, word for word. Returns nothing unless
// every label is found, in the order given, so a reworded row falls back to
// the site's own wording instead of a wrong cut.
export function splitAtLabels(definition: string, labels: string[]): Record<string, string> {
  const starts: number[] = [];
  let from = 0;
  for (const label of labels) {
    const marker = `${label}:`;
    let index = definition.indexOf(marker, from);
    // A marker starts the text or follows a space, so "Low:" never matches
    // inside a longer word.
    while (index > 0 && definition[index - 1] !== " ") {
      index = definition.indexOf(marker, index + 1);
    }
    if (index === -1) {
      return {};
    }
    starts.push(index);
    from = index + marker.length;
  }
  const pieces: Record<string, string> = {};
  labels.forEach((label, position) => {
    const textStart = starts[position] + label.length + 1;
    const textEnd = position + 1 < starts.length ? starts[position + 1] : definition.length;
    pieces[label] = definition.slice(textStart, textEnd).trim();
  });
  return pieces;
}

// Definitions for a scale's values from the Codebook rows of one type, keyed
// by value. A row whose code is the value's label gives its definition whole
// (the "Rating" rows: "Strong", "Moderate" ...). A row whose code lists several
// labels ("High / Medium / Low") is cut at its own markers (splitAtLabels).
// Values the Codebook doesn't define are left out, so the caller keeps the
// site's wording for them.
export function codebookDescriptions(
  rows: CodebookRow[],
  type: string,
  values: { value: string; label: string }[],
): Record<string, string> {
  const ofType: CodebookRow[] = [];
  for (const row of rows) {
    if (row.type === type) {
      ofType.push(row);
    }
  }
  const found: Record<string, string> = {};
  for (const info of values) {
    for (const row of ofType) {
      if (row.code === info.label && found[info.value] === undefined) {
        found[info.value] = row.definition;
      }
    }
  }
  for (const row of ofType) {
    const labels = row.code.split(" / ");
    if (labels.length < 2) {
      continue;
    }
    const pieces = splitAtLabels(row.definition, labels);
    for (const info of values) {
      const piece = pieces[info.label];
      if (found[info.value] === undefined && piece !== undefined && piece !== "") {
        found[info.value] = piece;
      }
    }
  }
  return found;
}

// How the Scope tab starts its key question note.
const KEY_QUESTION_MARK = "Key question:";
// How the Scope tab starts its own title ("§1 Scope (descriptive, unrated)").
const TAB_TITLE_MARK = "§";

// The Scope tab's notes to show under the Overview: every note but its key
// question, which repeats the Overview's purpose nearly word for word, and
// its title, which names a part of the workbook readers never see. The rest
// (the time-horizon bands) stay word for word, in order.
export function scopeNotesWithoutKeyQuestion(notes: string[]): string[] {
  const kept: string[] = [];
  for (const note of notes) {
    if (!note.startsWith(KEY_QUESTION_MARK) && !note.startsWith(TAB_TITLE_MARK)) {
      kept.push(note);
    }
  }
  return kept;
}

// The code a row shows. The rule rows ("Synthesis rule", "Status rule") have
// a lone "-" for a code, which tells a reader nothing, so they show none.
export function shownCode(code: string): string {
  return code.trim() === "-" ? "" : code;
}

// The id of the first fold that holds a type, for links like "Defined in full
// under Definitions" next to a scale. null when the Codebook has no such type.
export function runIdForType(runs: CodebookRun[], type: string): string | null {
  for (const run of runs) {
    if (run.type === type) {
      return run.id;
    }
  }
  return null;
}
