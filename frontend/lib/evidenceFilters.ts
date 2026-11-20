// The evidence register page (/evidence/): the filters, the search and the
// data each row needs. Pure: no React and no window, so
// tests/evidenceFilters.test.ts can load it.
//
// The filters live in the address, like the sources page:
//   /evidence/?family=wbe&feeds=wbe-alignment&role=supports&source=s13&q=scan
// Values the page doesn't know (a stale or mistyped link) fall back to "all".
import { familyOfCode } from "./codes";
import { enumLabel, enumValues } from "./enums";
import { shortCitation, type SourceRef } from "./sources";
import type { EvidenceEntry, Family, MilestoneCategoryInfo, ScorecardData } from "./types";
import { CODEBOOK_FAMILY, codebookRow, feedKey, feedKeys, outcomeLabels } from "./workbook";

// A select that isn't filtering.
export const ALL = "all";
// The "Ratings it informs" value for entries the register marks "Not used in a headline rating".
export const NOT_USED = "none";
// The family value for the register's Cross-family entries. Hyphenated in
// the address like the feed keys ("bci-intelligence-curse").
export const CROSS_FAMILY = "cross-family";
// The register's own words for an entry that feeds no rating.
export const NOT_USED_LABEL = "Not used in a headline rating";

// The address keeps the search in ?q= and each select under its own name.
export const QUERY_PARAM = "q";

export type EvidenceFilterName = "family" | "feeds" | "role" | "source";
export const FILTER_NAMES: EvidenceFilterName[] = ["family", "feeds", "role", "source"];

// What the visitor has typed and picked. ALL means a select isn't filtering.
export interface EvidenceSearch {
  query: string;
  family: string;
  feeds: string;
  role: string;
  source: string;
}

export const NO_EVIDENCE_SEARCH: EvidenceSearch = { query: "", family: ALL, feeds: ALL, role: ALL, source: ALL };

export interface OptionInfo {
  value: string;
  label: string;
}

export type EvidenceOptions = Record<EvidenceFilterName, OptionInfo[]>;

// ---------- Families ----------

const FAMILIES: Family[] = ["wbe", "bci", "neuromorphic"];

// The register's Family cell as the sheet writes it: "WBE", "BCI",
// "Neuromorphic AI" or "Cross-family".
export const FAMILY_WORDS: Record<Family | "cross_family", string> = {
  ...CODEBOOK_FAMILY,
  cross_family: "Cross-family",
};

export function familyOptions(): OptionInfo[] {
  const options: OptionInfo[] = [];
  for (const family of FAMILIES) {
    options.push({ value: family, label: FAMILY_WORDS[family] });
  }
  options.push({ value: CROSS_FAMILY, label: FAMILY_WORDS.cross_family });
  return options;
}

// An entry is under a family when its Family cell names it, or when its
// "Ratings it informs" names one of the family's ratings: a Cross-family entry
// such as E042 feeds a Neuromorphic AI rating. Cross-family picks the entries
// whose Family cell says Cross-family.
export function matchesFamily(entry: EvidenceEntry, family: string): boolean {
  if (family === CROSS_FAMILY) {
    return entry.family === "cross_family";
  }
  if (entry.family === family) {
    return true;
  }
  for (const feed of entry.feeds ?? []) {
    if (feed.family === family) {
      return true;
    }
  }
  return false;
}

// ---------- Ratings it informs ----------

// Where a target sorts among one family's options: Alignment, Intelligence
// Curse, then the milestones in number order.
function targetRank(target: string): number {
  if (target === "alignment") {
    return 0;
  }
  if (target === "intelligence_curse") {
    return 1;
  }
  const number = parseInt(target.slice(1), 10);
  return Number.isNaN(number) ? 1000 : 1 + number;
}

// A feed in column G's own words: "BCI Alignment", "Neuromorphic AI
// Intelligence Curse", "WBE M1 Technical capability". The milestone's name
// is the 1a category label, which is the name column G gives it.
export function feedLabel(family: Family, target: string, categories: MilestoneCategoryInfo[]): string {
  const familyWord = FAMILY_WORDS[family];
  if (target === "alignment") {
    return `${familyWord} Alignment`;
  }
  if (target === "intelligence_curse") {
    return `${familyWord} Intelligence Curse`;
  }
  const category = categories.find((info) => info.id === target);
  return category ? `${familyWord} ${target} ${category.label}` : `${familyWord} ${target}`;
}

// One option per rating that some entry feeds, grouped by family, then "Not
// used in a headline rating" when any entry feeds none. Options no entry has
// are left out, so the list never offers an empty rating.
export function feedOptions(entries: EvidenceEntry[], categories: MilestoneCategoryInfo[]): OptionInfo[] {
  const found: { family: Family; target: string; key: string }[] = [];
  let anyUnused = false;
  for (const entry of entries) {
    const feeds = entry.feeds ?? [];
    if (feeds.length === 0) {
      anyUnused = true;
    }
    for (const feed of feeds) {
      const key = feedKey(feed.family, feed.target);
      if (!found.some((item) => item.key === key)) {
        found.push({ family: feed.family, target: feed.target, key });
      }
    }
  }
  found.sort((a, b) => {
    const byFamily = FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family);
    if (byFamily !== 0) {
      return byFamily;
    }
    return targetRank(a.target) - targetRank(b.target);
  });
  const options: OptionInfo[] = [];
  for (const item of found) {
    options.push({ value: item.key, label: feedLabel(item.family, item.target, categories) });
  }
  if (anyUnused) {
    options.push({ value: NOT_USED, label: NOT_USED_LABEL });
  }
  return options;
}

export function matchesFeeds(entry: EvidenceEntry, feeds: string): boolean {
  if (feeds === NOT_USED) {
    return (entry.feeds ?? []).length === 0;
  }
  return feedKeys(entry).includes(feeds);
}

// ---------- Evidence role and source ----------

export function roleOptions(): OptionInfo[] {
  const options: OptionInfo[] = [];
  for (const info of enumValues("EvidenceRole")) {
    options.push({ value: info.value, label: info.label });
  }
  return options;
}

export function matchesRole(entry: EvidenceEntry, role: string): boolean {
  return entry.role === role;
}

// "S13 · Mineault et al. 2024", or just "S13" when the source isn't on the site.
export function sourceLabel(registerId: string, source: SourceRef | null): string {
  return source ? `${registerId} · ${shortCitation(source)}` : registerId;
}

// Whether a source's short citation is only the start of its title and the
// year, which shortCitation falls back to when there are no authors and no
// venue. A row that also prints the full title then leaves the citation out,
// so the title isn't shown twice.
export function citationRepeatsTitle(source: SourceRef): boolean {
  return source.authors.length === 0 && !source.venue;
}

// One option per source the entries cite, in register order (S01 first).
export function sourceOptions(rows: EvidenceRowData[]): OptionInfo[] {
  const seen: { registerId: string; option: OptionInfo }[] = [];
  for (const row of rows) {
    const { entry } = row;
    if (!seen.some((item) => item.option.value === entry.source_id)) {
      seen.push({
        registerId: entry.register_id,
        option: { value: entry.source_id, label: sourceLabel(entry.register_id, row.source) },
      });
    }
  }
  seen.sort((a, b) => registerNumber(a.registerId) - registerNumber(b.registerId));
  return seen.map((item) => item.option);
}

// "S13" -> 13. Anything else sorts last.
function registerNumber(registerId: string): number {
  const number = parseInt(registerId.slice(1), 10);
  return Number.isNaN(number) ? Number.MAX_SAFE_INTEGER : number;
}

export function matchesSource(entry: EvidenceEntry, source: string): boolean {
  return entry.source_id === source;
}

// ---------- What each row shows ----------

// The "Outcome addressed" cell as the row shows it: "AI alignment", and
// "Both" as the two outcomes it names ("AI alignment · Intelligence Curse").
export function outcomeText(entry: EvidenceEntry): string {
  return outcomeLabels(entry.outcome).join(" · ");
}

// One register entry with what its row needs besides the entry itself.
// Plain data, so the server page can hand it to the client list.
export interface EvidenceRowData {
  entry: EvidenceEntry;
  // Its source, for the citation and title. null if the site doesn't have it.
  source: SourceRef | null;
  // Codebook definitions, word for word, for the codes this entry shows:
  // its alignment problem, scenario codes and stage, keyed by code, and its
  // directness keyed by the sheet's label ("Direct (family itself)"). The
  // exception is a scenario code defined only by the wildcard row, which gets
  // that row's meaning for its last letter (SCENARIO_WILDCARD_WORDS).
  definitions: Record<string, string>;
}

// The Codebook's wildcard scenario row. Its definition ("Other /
// cross-cutting / unspecified" on the site; the sheet adds fill-in notes the
// import's site wording drops) covers the last letter of any family's code,
// so a code with no row of its own (WBE-C, BCI-U) is defined by that letter.
// The words are the row's three meanings, each with a capital letter.
export const SCENARIO_WILDCARD_CODE = "*-X / *-C / *-U";
export const SCENARIO_WILDCARD_WORDS: Record<string, string> = {
  X: "Other",
  C: "Cross-cutting",
  U: "Unspecified",
};

// "WBE-C" -> "Cross-cutting", when the Codebook has its wildcard row. A code
// that doesn't end in -X, -C or -U gets nothing.
export function wildcardScenarioDefinition(scorecard: ScorecardData, code: string): string | undefined {
  const match = /^[A-Z]+-([XCU])$/.exec(code);
  if (match === null || !codebookRow(scorecard, "Scenario", SCENARIO_WILDCARD_CODE)) {
    return undefined;
  }
  return SCENARIO_WILDCARD_WORDS[match[1]];
}

// The Codebook definitions one entry needs. A stage means different things
// per family, so it uses the entry's own family; a Cross-family entry's stage
// finds none and stays a bare code. A scenario code names its family in its
// prefix ("BCI-D"), so E109, a Cross-family entry, still gets BCI-D's text.
// A scenario code with its own row (BCI-X) keeps it; one without (WBE-C,
// BCI-U) takes the wildcard row's meaning for its last letter. Other codes
// the Codebook doesn't define (A-X, N/A) get nothing.
export function entryDefinitions(scorecard: ScorecardData, entry: EvidenceEntry): Record<string, string> {
  const definitions: Record<string, string> = {};
  const problem = codebookRow(scorecard, "Alignment problem", entry.alignment_problem);
  if (problem) {
    definitions[entry.alignment_problem] = problem.definition;
  }
  for (const code of entry.scenarios ?? []) {
    const scenario = codebookRow(scorecard, "Scenario", code, familyOfCode(code));
    const definition = scenario ? scenario.definition : wildcardScenarioDefinition(scorecard, code);
    if (definition) {
      definitions[code] = definition;
    }
  }
  const stage = codebookRow(scorecard, "Stage", entry.stage, entry.family);
  if (stage) {
    definitions[entry.stage] = stage.definition;
  }
  const directness = enumLabel("EvidenceDirectness", entry.directness);
  const directnessRow = codebookRow(scorecard, "Directness", directness);
  if (directnessRow) {
    definitions[directness] = directnessRow.definition;
  }
  return definitions;
}

// Every entry in register order, ready for the list.
export function evidenceRows(scorecard: ScorecardData, sources: Record<string, SourceRef>): EvidenceRowData[] {
  const rows: EvidenceRowData[] = [];
  for (const entry of scorecard.entries ?? []) {
    rows.push({ entry, source: sources[entry.source_id] ?? null, definitions: entryDefinitions(scorecard, entry) });
  }
  return rows;
}

// The muted line under a row's claim: "S13 · WBE · WBE Alignment (against
// or qualifies)", the last part column G word for word.
export function entryByline(entry: EvidenceEntry): string {
  return `${entry.register_id} · ${FAMILY_WORDS[entry.family]} · ${entry.feeds_text}`;
}

// ---------- The search ----------

// Lowercase with the accents taken off, so "Fidencio" finds "Fidêncio", and
// with hyphens and dashes read as spaces, so "close loop" finds "closed-loop"
// and "a vs" finds "A-VS". The same folding as the sources page.
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-‐-―−]/g, " ")
    .toLowerCase();
}

// "brain  interface" -> ["brain", "interface"]
export function splitQuery(query: string): string[] {
  const words: string[] = [];
  for (const part of fold(query).split(/\s+/)) {
    if (part !== "") {
      words.push(part);
    }
  }
  return words;
}

function isLetter(character: string): boolean {
  return /\p{L}/u.test(character);
}

function isDigit(character: string): boolean {
  return /\p{N}/u.test(character);
}

// Whether text has a word starting at index: at the very beginning, after a
// space or punctuation, or where digits follow a letter, so "042" finds "E042".
function isWordStart(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const before = text[index - 1];
  if (isDigit(text[index]) && isLetter(before)) {
    return true;
  }
  return !isLetter(before) && !isDigit(before);
}

// Whether word appears in text at the start of one of its words. So "align"
// finds "alignment" but not "misalignment".
export function hasAtWordStart(text: string, word: string): boolean {
  let index = text.indexOf(word);
  while (index !== -1) {
    if (isWordStart(text, index)) {
      return true;
    }
    index = text.indexOf(word, index + 1);
  }
  return false;
}

// Everything the search looks through for one row: every register column as
// the row shows it, the source's citation and title, and the Codebook
// definitions the row prints, so "overseer" finds the WBE-O entries.
export function searchText(row: EvidenceRowData): string {
  const { entry } = row;
  const parts = [
    entry.id,
    entry.register_id,
    entry.locator,
    entry.claim,
    (entry.codes ?? []).join(" "),
    FAMILY_WORDS[entry.family],
    entry.feeds_text,
    entry.source_type_independence,
    outcomeText(entry),
    entry.alignment_problem,
    (entry.scenarios ?? []).join(" "),
    entry.stage,
    enumLabel("EvidenceDirectness", entry.directness),
    enumLabel("EvidenceRole", entry.role),
    enumLabel("EvidenceBasis", entry.basis),
    Object.values(row.definitions).join(" "),
  ];
  if (row.source) {
    parts.push(shortCitation(row.source), row.source.title);
  }
  return fold(parts.join(" "));
}

// Every word has to begin a word somewhere in the row's search text.
export function matchesWords(text: string, words: string[]): boolean {
  for (const word of words) {
    if (!hasAtWordStart(text, word)) {
      return false;
    }
  }
  return true;
}

// ---------- Filtering and counting ----------

function matchesFilter(entry: EvidenceEntry, name: EvidenceFilterName, value: string): boolean {
  if (name === "family") {
    return matchesFamily(entry, value);
  }
  if (name === "feeds") {
    return matchesFeeds(entry, value);
  }
  if (name === "role") {
    return matchesRole(entry, value);
  }
  return matchesSource(entry, value);
}

// Whether an entry passes every select except skip (null checks all four).
// The search words are checked separately, since they always apply.
export function matchesFilters(entry: EvidenceEntry, search: EvidenceSearch, skip: EvidenceFilterName | null): boolean {
  for (const name of FILTER_NAMES) {
    if (name === skip || search[name] === ALL) {
      continue;
    }
    if (!matchesFilter(entry, name, search[name])) {
      return false;
    }
  }
  return true;
}

// Whether a row is in the list the search and all four selects leave.
export function isShown(row: EvidenceRowData, search: EvidenceSearch): boolean {
  return matchesWords(searchText(row), splitQuery(search.query)) && matchesFilters(row.entry, search, null);
}

export interface FilterOption extends OptionInfo {
  count: number;
  disabled: boolean;
}

// The options for one select with live counts. context holds the rows that
// pass the search and the other selects, so an option's count is how many
// rows picking it would show. One that only the other filters rule out stays
// in, disabled, so the list doesn't change shape as filters are picked. The
// picked option is never disabled; otherwise the select would show "All"
// while its filter is still on.
export function optionsWithCounts(
  context: EvidenceRowData[],
  name: EvidenceFilterName,
  values: OptionInfo[],
  selected: string,
): FilterOption[] {
  const options: FilterOption[] = [];
  for (const info of values) {
    let count = 0;
    for (const row of context) {
      if (matchesFilter(row.entry, name, info.value)) {
        count += 1;
      }
    }
    const isSelected = info.value === selected;
    options.push({ value: info.value, label: info.label, count, disabled: count === 0 && !isSelected });
  }
  return options;
}

// How many of the four selects are filtering, for the phone's "Filters (2)".
export function countActiveFilters(search: EvidenceSearch): number {
  let count = 0;
  for (const name of FILTER_NAMES) {
    if (search[name] !== ALL) {
      count += 1;
    }
  }
  return count;
}

// One select that is filtering, named as the select shows it.
export interface ActiveFilter {
  name: EvidenceFilterName;
  // The picked option's label, e.g. "BCI Alignment".
  label: string;
}

// The selects that are filtering, in the order they appear, with the label of
// the option each has picked. Phones list these under the folded "Filters"
// button, so a filtered list says what it is filtered to.
export function activeFilters(search: EvidenceSearch, options: EvidenceOptions): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  for (const name of FILTER_NAMES) {
    const value = search[name];
    if (value === ALL) {
      continue;
    }
    const option = options[name].find((info) => info.value === value);
    active.push({ name, label: option ? option.label : value });
  }
  return active;
}

// ---------- The address ----------

// A select's value as links may write it: "S13" and "s13" both mean s13,
// "cross_family" means cross-family, "bci-intelligence_curse" means
// bci-intelligence-curse.
function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

// A select's value from the address, or ALL when it's missing or isn't one of
// the select's values.
function paramValue(params: URLSearchParams, name: string, values: OptionInfo[]): string {
  const raw = params.get(name);
  if (raw === null) {
    return ALL;
  }
  const wanted = normalizeValue(raw);
  for (const info of values) {
    if (normalizeValue(info.value) === wanted) {
      return info.value;
    }
  }
  return ALL;
}

// The search and filters an address asks for.
export function readSearch(params: URLSearchParams, options: EvidenceOptions): EvidenceSearch {
  return {
    query: params.get(QUERY_PARAM) ?? "",
    family: paramValue(params, "family", options.family),
    feeds: paramValue(params, "feeds", options.feeds),
    role: paramValue(params, "role", options.role),
    source: paramValue(params, "source", options.source),
  };
}

// The query string for a search, leaving out the defaults, so an unfiltered
// list is plain /evidence/. "" or "family=wbe&q=scan" (no leading "?").
export function searchQueryString(search: EvidenceSearch): string {
  const params = new URLSearchParams();
  if (search.query.trim() !== "") {
    params.set(QUERY_PARAM, search.query);
  }
  for (const name of FILTER_NAMES) {
    if (search[name] !== ALL) {
      params.set(name, search[name]);
    }
  }
  return params.toString();
}
