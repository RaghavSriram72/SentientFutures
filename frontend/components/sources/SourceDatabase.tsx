"use client";

import Link from "next/link";
import { Suspense, useEffect, useEffectEvent, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { isReturnVisit, ownHistoryState } from "@/components/common/HashLinkHistory";
import { enumLabel, enumValues } from "@/lib/enums";
import { sourceRefsById } from "@/lib/sources";
import type { ClaimDirection, Source } from "@/lib/types";

import { directionTone } from "./ClaimDirectionChip";
import {
  applyRowRequest,
  clearHighlight,
  currentAddress,
  LIVE,
  rememberedRows,
  rememberOpenRows,
  rowIdFromHash,
  type ListAddress,
  type RowRequest,
} from "./linkedRows";
import { ActiveFilterChips, AddressWatcher, SearchIcon, type FilterChip } from "./ListParts";
import styles from "./SourceDatabase.module.css";
import { SourceRow, TECHNOLOGY_SHORT, rowByline } from "./SourceRow";
import { isScreeningPending, shownDirections } from "./sourceFacts";

const ALL = "all";
// Select values for the empty cases, which have no enum value of their own.
const GENERAL_BACKGROUND = "general";
const NEITHER = "neither";

// Every value each select can take, apart from ALL.
const TECHNOLOGY_VALUES = [...enumValues("Technology"), { value: GENERAL_BACKGROUND, label: "General background" }];
const DIRECTION_VALUES = enumValues("ClaimDirection");
const PROBLEM_VALUES = [...enumValues("Problem"), { value: NEITHER, label: "Neither" }];

// The address keeps the search in ?q= and each select under its own name, e.g.
// /sources/?technology=bci&q=alignment
const QUERY_PARAM = "q";

// How much of the first result has to be on screen, in px, for Enter in the
// search to leave the page where it is: about its title line.
const FIRST_ROW_PEEK = 64;

// What the visitor has typed and picked. ALL means a select isn't filtering.
interface SearchState {
  query: string;
  technology: string;
  direction: string;
  problem: string;
}

const NO_SEARCH: SearchState = { query: "", technology: ALL, direction: ALL, problem: ALL };

type FilterName = "technology" | "direction" | "problem";

// Each select's label, shown over the select and on its chip on phones.
const FILTER_LABELS: Record<FilterName, string> = {
  technology: "Technology",
  direction: "Which way it argues",
  problem: "Problem",
};

// Lowercase with the accents taken off, so "Fidencio" finds "Fidêncio", and
// with hyphens and dashes read as spaces, so "whole-brain emulation" finds
// "Whole brain emulation" and "peer-reviewed" finds "Peer reviewed".
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-\u2010-\u2015\u2212]/g, " ")
    .toLowerCase();
}

// "brain  interface" -> ["brain", "interface"]
function splitQuery(query: string): string[] {
  const words: string[] = [];
  for (const part of fold(query).split(/\s+/)) {
    if (part !== "") {
      words.push(part);
    }
  }
  return words;
}

// Everything the search looks through for one source: the register id, title,
// authors, venue and the team's summary, plus what the row shows besides
// (the year and source type, the technology tags) and the short technology
// values such as "bci" and "wbe". The problem tag is left out, so a search for
// "both" doesn't match every source tagged Both. The claim direction tags are
// searched separately, by directionWords.
function searchText(source: Source): string {
  const parts = [
    source.register_id ?? "",
    source.title,
    source.authors.join(" "),
    source.venue ?? "",
    source.summary.text,
    rowByline(source),
  ];
  if (source.technology.length === 0) {
    parts.push("General background");
  }
  for (const technology of source.technology) {
    parts.push(technology, enumLabel("Technology", technology), TECHNOLOGY_SHORT[technology]);
  }
  return fold(parts.join(" "));
}

// The words of the source's claim direction tags, e.g. ["human", "disempowerment"].
// None while screening is pending, since the row doesn't show them.
function directionWords(source: Source): string[] {
  const labels: string[] = [];
  for (const direction of shownDirections(source)) {
    labels.push(enumLabel("ClaimDirection", direction));
  }
  return splitQuery(labels.join(" "));
}

function isLetter(character: string): boolean {
  return /\p{L}/u.test(character);
}

function isDigit(character: string): boolean {
  return /\p{N}/u.test(character);
}

// Whether text has a word starting at index: at the very beginning, after a
// space or punctuation, or where digits follow a letter, so "02" finds "S02".
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

// Whether word appears in text at the start of one of its words. So "brain"
// finds "brain computer interface" and "(brain", but "empowerment" doesn't
// find "disempowerment".
function hasAtWordStart(text: string, word: string): boolean {
  let index = text.indexOf(word);
  while (index !== -1) {
    if (isWordStart(text, index)) {
      return true;
    }
    index = text.indexOf(word, index + 1);
  }
  return false;
}

// Every word has to begin a word somewhere in the source's search text, or
// begin one of its claim direction words. Only the beginning counts, so
// "empowerment" doesn't find a source tagged or summed up as "Human
// disempowerment", nor "alignment" one about "AI misalignment": those argue
// the other way.
function matchesWords(source: Source, words: string[]): boolean {
  if (words.length === 0) {
    return true;
  }
  const haystack = searchText(source);
  const tagWords = directionWords(source);
  for (const word of words) {
    if (hasAtWordStart(haystack, word)) {
      continue;
    }
    let beginsTagWord = false;
    for (const tagWord of tagWords) {
      if (tagWord.startsWith(word)) {
        beginsTagWord = true;
      }
    }
    if (!beginsTagWord) {
      return false;
    }
  }
  return true;
}

// technology is a select value: an enum value, or GENERAL_BACKGROUND for
// sources with no technology tagged.
function matchesTechnology(source: Source, technology: string): boolean {
  if (technology === GENERAL_BACKGROUND) {
    return source.technology.length === 0;
  }
  for (const value of source.technology) {
    if (value === technology) {
      return true;
    }
  }
  return false;
}

// A source whose screening is pending shows no claim directions, so it
// matches none.
function matchesDirection(source: Source, direction: string): boolean {
  for (const value of shownDirections(source)) {
    if (value === direction) {
      return true;
    }
  }
  return false;
}

// problem is a select value: an enum value, or NEITHER for a null problem.
// A source tagged "both" addresses alignment and the Intelligence Curse, so it
// shows under either one as well as under "Both". A source whose screening is
// pending shows no problem, so it matches no problem, Neither included.
function matchesProblem(source: Source, problem: string): boolean {
  if (isScreeningPending(source)) {
    return false;
  }
  if (problem === NEITHER) {
    return source.problem === null;
  }
  if (source.problem === "both" && (problem === "alignment" || problem === "intelligence_curse")) {
    return true;
  }
  return source.problem === problem;
}

// Whether a source passes every select except skip (null checks all three).
// The search words are checked separately, since they always apply.
function matchesFilters(source: Source, search: SearchState, skip: FilterName | null): boolean {
  if (skip !== "technology" && search.technology !== ALL && !matchesTechnology(source, search.technology)) {
    return false;
  }
  if (skip !== "direction" && search.direction !== ALL && !matchesDirection(source, search.direction)) {
    return false;
  }
  if (skip !== "problem" && search.problem !== ALL && !matchesProblem(source, search.problem)) {
    return false;
  }
  return true;
}

// Whether a source is in the list the search and all three selects leave.
function isShown(source: Source, search: SearchState): boolean {
  return matchesWords(source, splitQuery(search.query)) && matchesFilters(source, search, null);
}

function passingFilters(sources: Source[], search: SearchState, skip: FilterName | null): Source[] {
  const passing: Source[] = [];
  for (const source of sources) {
    if (matchesFilters(source, search, skip)) {
      passing.push(source);
    }
  }
  return passing;
}

function countMatching(sources: Source[], matches: (source: Source) => boolean): number {
  let count = 0;
  for (const source of sources) {
    if (matches(source)) {
      count += 1;
    }
  }
  return count;
}

interface FilterOption {
  value: string;
  label: string;
  count: number;
  disabled: boolean;
}

// The options for one select. context holds the sources that pass the search
// and the other two selects, so an option's count is how many rows picking it
// would show. An option no source has at all is left out, so the list never
// offers "Hybrid (0)". One that only the other filters rule out stays in,
// disabled, so the list doesn't change shape as filters are picked. The picked
// option always stays and is never disabled; otherwise the select would show
// "All" while its filter is still on.
function optionsWithCounts(
  sources: Source[],
  context: Source[],
  values: { value: string; label: string }[],
  matches: (source: Source, value: string) => boolean,
  selected: string,
): FilterOption[] {
  const options: FilterOption[] = [];
  for (const info of values) {
    const isSelected = info.value === selected;
    const total = countMatching(sources, (source) => matches(source, info.value));
    if (total === 0 && !isSelected) {
      continue;
    }
    const count = countMatching(context, (source) => matches(source, info.value));
    options.push({ value: info.value, label: info.label, count, disabled: count === 0 && !isSelected });
  }
  return options;
}

// The plus or minus in a circle for a claim direction option. An option can
// only hold text, so these stand in for the ringed glyphs on the chips and in
// the key above the filters.
function directionSign(direction: string): string {
  return directionTone(direction as ClaimDirection) === "for" ? "\u2295" : "\u2296";
}

// The selects that are filtering, for the chips under the phone's folded
// "Filters" button: each select's label and its picked option, written as the
// select writes it (a direction keeps its plus or minus sign).
function filterChips(search: SearchState): FilterChip[] {
  const chips: FilterChip[] = [];
  const selects: { key: FilterName; values: { value: string; label: string }[] }[] = [
    { key: "technology", values: TECHNOLOGY_VALUES },
    { key: "direction", values: DIRECTION_VALUES },
    { key: "problem", values: PROBLEM_VALUES },
  ];
  for (const select of selects) {
    const picked = select.values.find((info) => info.value === search[select.key]);
    if (picked === undefined) {
      continue;
    }
    const value = select.key === "direction" ? `${directionSign(picked.value)} ${picked.label}` : picked.label;
    chips.push({ key: select.key, filter: FILTER_LABELS[select.key], value });
  }
  return chips;
}

// How many of the three selects are filtering, for the phone's "Filters (2)".
function countActiveFilters(search: SearchState): number {
  let count = 0;
  for (const value of [search.technology, search.direction, search.problem]) {
    if (value !== ALL) {
      count += 1;
    }
  }
  return count;
}

// A select's value from the address, or ALL when it's missing or isn't one of
// the select's values (a stale or mistyped link).
function paramValue(params: URLSearchParams, name: string, values: { value: string }[]): string {
  const wanted = params.get(name);
  for (const info of values) {
    if (info.value === wanted) {
      return info.value;
    }
  }
  return ALL;
}

// The current address with the search and filters in it, leaving out the
// defaults, so an unfiltered list is plain /sources/. Keeps the hash if asked.
function addressFor(search: SearchState, keepHash: boolean): string {
  const params = new URLSearchParams();
  if (search.query.trim() !== "") {
    params.set(QUERY_PARAM, search.query);
  }
  if (search.technology !== ALL) {
    params.set("technology", search.technology);
  }
  if (search.direction !== ALL) {
    params.set("direction", search.direction);
  }
  if (search.problem !== ALL) {
    params.set("problem", search.problem);
  }
  const query = params.toString();
  return window.location.pathname + (query === "" ? "" : `?${query}`) + (keepHash ? window.location.hash : "");
}

function findSource(sources: Source[], id: string): Source | null {
  for (const source of sources) {
    if (source.id === id) {
      return source;
    }
  }
  return null;
}

// The search and filters the address asks for, and the source its hash links
// to, if any. Each select value is checked against the select's values, so a
// stale or mistyped one falls back to ALL. A link to one row wins over
// filters that would hide it.
function readAddress(sources: Source[]): { search: SearchState; linked: Source | null } {
  const params = new URLSearchParams(window.location.search);
  let search: SearchState = {
    query: params.get(QUERY_PARAM) ?? "",
    technology: paramValue(params, "technology", TECHNOLOGY_VALUES),
    direction: paramValue(params, "direction", DIRECTION_VALUES),
    problem: paramValue(params, "problem", PROBLEM_VALUES),
  };
  const linked = findSource(sources, rowIdFromHash());
  if (linked !== null && !isShown(linked, search)) {
    search = NO_SEARCH;
  }
  return { search, linked };
}

// Puts the search and filters in the address, so a reload, Back or a shared
// link shows the same list. replaceState changes it without a navigation, so
// typing adds no history entries and fetches nothing. A hash whose row the
// new filters hide is dropped, ring and all; kept, it would undo the filters
// on the next reload or Back.
function writeAddress(search: SearchState, sources: Source[]) {
  const linked = findSource(sources, rowIdFromHash());
  const keepHash = linked === null || isShown(linked, search);
  if (!keepHash) {
    clearHighlight();
  }
  const address = addressFor(search, keepHash);
  if (address !== window.location.pathname + window.location.search + window.location.hash) {
    try {
      // Keeps the open rows and the scroll position stored on the entry.
      window.history.replaceState(ownHistoryState(), "", address);
    } catch {
      // Safari throws after about 100 calls in 30 seconds. The list still
      // works; the address just lags until the next change.
    }
  }
}

interface SourceDatabaseProps {
  sources: Source[];
  // Passed on to each row: see CatalogCard's CardOptions.
  sharedAddedBy?: string | null;
  hideUnrated?: boolean;
  // Shown in the results bar, beside the count: the "How to read the marks" disclosure.
  marks?: ReactNode;
  // Shown between the filters and the results: the key to the plus and minus glyphs.
  directionKey?: ReactNode;
  // Source id -> how many evidence register entries cite it. A source with a
  // register id that isn't here has none. Leave it out to show no counts.
  entryCounts?: Record<string, number>;
}

// The count a row shows: null when the page passes no counts or the source
// isn't in the register (no register id).
function entryCountFor(source: Source, entryCounts: Record<string, number> | undefined): number | null {
  if (entryCounts === undefined || !source.register_id) {
    return null;
  }
  return entryCounts[source.id] ?? 0;
}

// The searchable source list. Gets every source to show as a prop, already in
// order, and filters in the browser; there are few enough that no index is needed.
export function SourceDatabase({
  sources,
  sharedAddedBy = null,
  hideUnrated = false,
  marks,
  directionKey,
  entryCounts,
}: SourceDatabaseProps) {
  const [search, setSearch] = useState<SearchState>(NO_SEARCH);
  const { query, technology, direction, problem } = search;
  // What a link or Back asked of the rows, done once the list has rendered. A
  // new object each time, so asking for the same row twice still opens it.
  const [rowRequest, setRowRequest] = useState<RowRequest | null>(null);
  // Phones only: whether the three selects are showing. Wider screens always show them.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const databaseRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersToggleRef = useRef<HTMLButtonElement>(null);
  const resultsBarRef = useRef<HTMLDivElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  // The query string and hash the list last read from the address or wrote
  // to it, or null before the first read. The address only differs from it
  // after a link or Back that changed it without remounting the list.
  const knownAddress = useRef<ListAddress | null>(null);
  // So a summary that cites other sources keeps its citation links.
  const sourceRefs = sourceRefsById(sources);

  // Every change to the search or a filter goes through here, so the address
  // always says what the list shows.
  function changeSearch(next: SearchState) {
    setSearch(next);
    writeAddress(next, sources);
    knownAddress.current = currentAddress();
  }

  // Takes the search and filters from the address, so a reload, Back or a
  // shared link shows the same list, then opens the row the hash points at.
  // Writing them straight back cleans out a stale value or filters the hash
  // overrode, which would otherwise stay in the address unapplied.
  // Coming back to this history entry, the rows the reader had open open
  // again instead. Otherwise the list starts over as a fresh load of the
  // address shows it, with only the linked row open, so the header's "Source
  // database" link doesn't leave the last linked row open and ringed.
  function followAddress() {
    const { search: fromAddress, linked } = readAddress(sources);
    changeSearch(fromAddress);
    const linkedId = linked === null ? null : linked.id;
    if (linkedId === null) {
      clearHighlight();
    }
    if (isReturnVisit()) {
      setRowRequest({ linkedId, returning: true, openIds: rememberedRows() });
    } else {
      setRowRequest({ linkedId, returning: false, openIds: [] });
    }
  }

  // Only the hash changed, such as Back from one linked row to another or a
  // link to another row. The other rows stay as they are.
  function followHash() {
    knownAddress.current = currentAddress();
    const source = findSource(sources, rowIdFromHash());
    const returning = isReturnVisit();
    if (source === null) {
      clearHighlight();
      if (returning) {
        setRowRequest({ linkedId: null, returning, openIds: rememberedRows() });
      }
      return;
    }
    // Its row is hidden by the search or a filter: show everything first.
    if (document.getElementById(source.id) === null) {
      changeSearch(NO_SEARCH);
    }
    setRowRequest({ linkedId: source.id, returning, openIds: returning ? rememberedRows() : null });
  }

  // Checks whether the address changed: either by the list's own write, or by
  // a link or Back that stayed on this page, like the header's "Source
  // database" link clicked on a filtered list. Only the second needs
  // following: a new query string in full, a new hash just for its row.
  function onAddressChange() {
    const known = knownAddress.current;
    if (known === null) {
      return;
    }
    const address = currentAddress();
    if (address.search === known.search && address.hash === known.hash) {
      return;
    }
    // A link to an address without a row in it, like the header's "Source
    // database" on /sources/#s02 or /sources/?technology=wbe. It starts over
    // at the top, as a fresh load would. The header's and footer's links
    // already scroll there (backToTop), but the router doesn't, so any other
    // link would stay put. The CSS's smooth scrolling, the same as
    // backToTop's, carries on that scroll instead of cutting it short.
    const startsOver = address.hash === "" && !isReturnVisit();
    if (address.search !== known.search || startsOver) {
      followAddress();
    } else {
      followHash();
    }
    if (startsOver) {
      window.scrollTo({ top: 0 });
    }
  }

  const arrive = useEffectEvent(followAddress);
  const addressChanged = useEffectEvent(onAddressChange);

  // Runs after the render that put the requested rows on the page.
  useEffect(() => {
    if (rowRequest !== null) {
      applyRowRequest(listRef.current, rowRequest);
    }
  }, [rowRequest]);

  // On arrival, follow the address. Restoring it can only happen after
  // hydration, since the server-rendered list is the unfiltered one. After
  // that, follow hash changes, and keep the open rows on the history entry
  // each time one opens or closes, however the reader leaves it.
  useEffect(() => {
    databaseRef.current?.setAttribute(LIVE, "");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    arrive();
    function onHashChange() {
      addressChanged();
    }
    // toggle doesn't bubble, so it's caught on the way down.
    function onToggle(event: Event) {
      if (event.target instanceof HTMLDetailsElement) {
        rememberOpenRows(listRef.current);
      }
    }
    const database = databaseRef.current;
    window.addEventListener("hashchange", onHashChange);
    database?.addEventListener("toggle", onToggle, true);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      database?.removeEventListener("toggle", onToggle, true);
    };
  }, []);

  const words = splitQuery(query);
  // The search applies to every count below, so it runs once.
  const searched: Source[] = [];
  for (const source of sources) {
    if (matchesWords(source, words)) {
      searched.push(source);
    }
  }

  // Each select counts its options against the search and the other two
  // selects, so the number on an option is the number of rows it would show.
  const technologyOptions = optionsWithCounts(
    sources,
    passingFilters(searched, search, "technology"),
    TECHNOLOGY_VALUES,
    matchesTechnology,
    technology,
  );
  const directionOptions = optionsWithCounts(
    sources,
    passingFilters(searched, search, "direction"),
    DIRECTION_VALUES,
    matchesDirection,
    direction,
  );
  const problemOptions = optionsWithCounts(
    sources,
    passingFilters(searched, search, "problem"),
    PROBLEM_VALUES,
    matchesProblem,
    problem,
  );

  const visible = passingFilters(searched, search, null);

  const activeFilters = countActiveFilters(search);
  const isFiltered = words.length > 0 || activeFilters > 0;

  // A chip under the folded "Filters" button turns its select back to all.
  // The chip goes away, so focus moves to the button above it.
  function removeFilter(key: string) {
    if (key === "technology" || key === "direction" || key === "problem") {
      changeSearch({ ...search, [key]: ALL });
    }
    filtersToggleRef.current?.focus();
  }

  function clearFilters() {
    changeSearch(NO_SEARCH);
    // The button just used goes away with the filters. Moving focus to the
    // results heading keeps screen readers in place, and unlike the search box
    // it doesn't open the phone keyboard.
    resultsHeadingRef.current?.focus({ preventScroll: true });
  }

  // Enter, or the Search key on a phone keyboard. The list filters as you
  // type, so this only brings the results into view when they're off screen,
  // closing the phone keyboard so they can be seen.
  function showResults(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bar = resultsBarRef.current;
    if (bar === null) {
      return;
    }
    // The part of the window that can be seen. On a phone the visual viewport
    // leaves out the keyboard, and offsetTop is how far it has panned down.
    const view = window.visualViewport;
    const viewTop = view ? view.offsetTop : 0;
    const viewBottom = view ? view.offsetTop + view.height : window.innerHeight;
    const barBox = bar.getBoundingClientRect();
    // The count and the top of the first result are already in sight (as on
    // a laptop), so leave the page and the focus where they are.
    if (barBox.top >= viewTop && barBox.bottom + FIRST_ROW_PEEK <= viewBottom) {
      return;
    }
    searchRef.current?.blur();
    bar.scrollIntoView({ block: "start" });
  }

  return (
    <div ref={databaseRef} className={styles.database}>
      {/* Its own Suspense boundary, so the static export still prerenders the list. */}
      <Suspense fallback={null}>
        <AddressWatcher onChange={onAddressChange} />
      </Suspense>

      <form className={styles.filters} role="search" aria-label="Filter sources" onSubmit={showResults}>
        <div className={`${styles.control} ${styles.searchControl}`}>
          <label htmlFor="source-search" className={styles.label}>
            Search
          </label>
          <div className={styles.searchWrap}>
            <SearchIcon />
            <input
              ref={searchRef}
              id="source-search"
              type="search"
              className={styles.input}
              placeholder="Title, author, ID or summary"
              autoComplete="off"
              enterKeyHint="search"
              value={query}
              onChange={(event) => changeSearch({ ...search, query: event.target.value })}
            />
          </div>
        </div>

        {/* On phones the three selects fold behind this button, so the first
            sources fit on the first screen. Its count keeps a folded panel from
            hiding that the list is filtered. Wider screens never show it. */}
        <button
          ref={filtersToggleRef}
          type="button"
          className={styles.filtersToggle}
          aria-expanded={filtersOpen}
          aria-controls="source-filter-selects"
          aria-label={activeFilters > 0 ? `Filters, ${activeFilters} active` : "Filters"}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          {activeFilters > 0 ? `Filters (${activeFilters})` : "Filters"}
          <span className={styles.filtersChevron} aria-hidden="true" />
        </button>

        {!filtersOpen && <ActiveFilterChips chips={filterChips(search)} onRemove={removeFilter} />}

        <div
          id="source-filter-selects"
          className={`${styles.selects} ${filtersOpen ? styles.selectsOpen : ""}`}
        >
          <div className={styles.control}>
            <label htmlFor="source-technology" className={styles.label}>
              {FILTER_LABELS.technology}
            </label>
            <div className={styles.selectWrap}>
              <select
                id="source-technology"
                className={styles.select}
                value={technology}
                onChange={(event) => changeSearch({ ...search, technology: event.target.value })}
              >
                <option value={ALL}>All technologies</option>
                {technologyOptions.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.control}>
            <label htmlFor="source-direction" className={styles.label}>
              {FILTER_LABELS.direction}
            </label>
            <div className={styles.selectWrap}>
              <select
                id="source-direction"
                className={styles.select}
                value={direction}
                onChange={(event) => changeSearch({ ...search, direction: event.target.value })}
              >
                <option value={ALL}>All directions</option>
                {directionOptions.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {directionSign(option.value)} {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.control}>
            <label htmlFor="source-problem" className={styles.label}>
              {FILTER_LABELS.problem}
            </label>
            <div className={styles.selectWrap}>
              <select
                id="source-problem"
                className={styles.select}
                value={problem}
                onChange={(event) => changeSearch({ ...search, problem: event.target.value })}
              >
                <option value={ALL}>All problems</option>
                {problemOptions.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </form>

      {directionKey}

      <div ref={resultsBarRef} className={styles.resultsBar}>
        <p className={styles.count} aria-live="polite">
          {visible.length === sources.length
            ? `${sources.length} ${sources.length === 1 ? "source" : "sources"}`
            : `${visible.length} of ${sources.length} sources`}
        </p>
        {marks && <div className={styles.marks}>{marks}</div>}
        {/* With nothing found, the empty state below has its own button. */}
        {isFiltered && visible.length > 0 && (
          <button type="button" className={styles.clear} onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <section aria-labelledby="source-results-heading">
        <h2 id="source-results-heading" ref={resultsHeadingRef} tabIndex={-1} className="visually-hidden">
          Matching sources
        </h2>
        {visible.length > 0 ? (
          <ul ref={listRef} className={styles.list}>
            {visible.map((source) => (
              <li key={source.id}>
                <SourceRow
                  source={source}
                  sources={sourceRefs}
                  sharedAddedBy={sharedAddedBy}
                  hideUnrated={hideUnrated}
                  entryCount={entryCountFor(source, entryCounts)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className={`paper ${styles.empty}`}>
            <p className={styles.emptyTitle}>
              Nothing matches <em>that</em> yet.
            </p>
            {/* "Show all sources" below resets the filters, so the hint only
                speaks to the search words. */}
            <p className={styles.emptyText}>
              {words.length > 0 && "Try fewer words. "}
              If you know a source we should have, <Link href="/contact/">tell us about it</Link>.
            </p>
            <button type="button" className="btn btn-secondary" onClick={clearFilters}>
              Show all sources
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
