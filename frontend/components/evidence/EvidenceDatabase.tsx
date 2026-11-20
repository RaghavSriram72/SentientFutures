"use client";

import { Suspense, useEffect, useEffectEvent, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { isReturnVisit, ownHistoryState } from "@/components/common/HashLinkHistory";
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
} from "@/components/sources/linkedRows";
import { ActiveFilterChips, AddressWatcher, SearchIcon } from "@/components/sources/ListParts";
import sourceStyles from "@/components/sources/SourceDatabase.module.css";
import type { CodeIndex } from "@/lib/codes";
import { entryAnchor } from "@/lib/codes";
import {
  ALL,
  CROSS_FAMILY,
  FILTER_NAMES,
  NO_EVIDENCE_SEARCH,
  activeFilters as activeFilterList,
  countActiveFilters,
  isShown,
  matchesFilters,
  matchesWords,
  optionsWithCounts,
  readSearch,
  searchQueryString,
  searchText,
  splitQuery,
  type EvidenceFilterName,
  type EvidenceOptions,
  type EvidenceRowData,
  type EvidenceSearch,
  type FilterOption,
} from "@/lib/evidenceFilters";

import styles from "./EvidenceDatabase.module.css";
import { EvidenceRow } from "./EvidenceRow";

// Each select's label, shown over the select and on its chip on phones.
const FILTER_LABELS: Record<EvidenceFilterName, string> = {
  family: "Family",
  feeds: "Ratings it informs",
  role: "Evidence role",
  source: "Source ID",
};

// How much of the first result has to be on screen, in px, for Enter in the
// search to leave the page where it is: about its first line.
const FIRST_ROW_PEEK = 64;

// The row a hash names: "#e042" or "#E042".
function findRow(rows: EvidenceRowData[], id: string): EvidenceRowData | null {
  for (const row of rows) {
    if (entryAnchor(row.entry.id) === id) {
      return row;
    }
  }
  return null;
}

// The current address with the search and filters in it. Keeps the hash if asked.
function addressFor(search: EvidenceSearch, keepHash: boolean): string {
  const query = searchQueryString(search);
  return window.location.pathname + (query === "" ? "" : `?${query}`) + (keepHash ? window.location.hash : "");
}

// The search and filters the address asks for, and the row its hash links
// to, if any. A link to one row wins over filters that would hide it.
function readAddress(
  rows: EvidenceRowData[],
  options: EvidenceOptions,
): { search: EvidenceSearch; linked: EvidenceRowData | null } {
  let search = readSearch(new URLSearchParams(window.location.search), options);
  const linked = findRow(rows, rowIdFromHash());
  if (linked !== null && !isShown(linked, search)) {
    search = NO_EVIDENCE_SEARCH;
  }
  return { search, linked };
}

// Puts the search and filters in the address, so a reload, Back or a shared
// link shows the same list. replaceState changes it without a navigation. A
// hash whose row the new filters hide is dropped, ring and all; kept, it
// would undo the filters on the next reload or Back.
function writeAddress(search: EvidenceSearch, rows: EvidenceRowData[]) {
  const linked = findRow(rows, rowIdFromHash());
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

interface EvidenceDatabaseProps {
  // Every entry, in register order (evidenceRows in lib/evidenceFilters.ts).
  rows: EvidenceRowData[];
  // What the codes in a row link to (buildCodeIndex in lib/codes.ts).
  index: CodeIndex;
  // The values each select offers, built on the server.
  options: EvidenceOptions;
  // The Scope tab's Cross-family row, shown while Cross-family is picked.
  crossFamilyNote?: ReactNode;
}

// The searchable evidence register. Works like the sources page: the filters
// live in the address, a link to /evidence/#e042 opens, rings and scrolls to
// that row (clearing filters that would hide it), and Back or a reload
// reopens the rows the reader had open.
export function EvidenceDatabase({ rows, index, options, crossFamilyNote }: EvidenceDatabaseProps) {
  const [search, setSearch] = useState<EvidenceSearch>(NO_EVIDENCE_SEARCH);
  // What a link or Back asked of the rows, done once the list has rendered.
  const [rowRequest, setRowRequest] = useState<RowRequest | null>(null);
  // Phones only: whether the selects are showing.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const databaseRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersToggleRef = useRef<HTMLButtonElement>(null);
  const resultsBarRef = useRef<HTMLDivElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  // The query string and hash the list last read or wrote, or null before
  // the first read. See SourceDatabase, which this follows.
  const knownAddress = useRef<ListAddress | null>(null);

  // Every change to the search or a filter goes through here, so the address
  // always says what the list shows.
  function changeSearch(next: EvidenceSearch) {
    setSearch(next);
    writeAddress(next, rows);
    knownAddress.current = currentAddress();
  }

  // Takes the search and filters from the address, then opens the row the
  // hash points at. Coming back to this history entry, the rows the reader
  // had open open again instead.
  function followAddress() {
    const { search: fromAddress, linked } = readAddress(rows, options);
    changeSearch(fromAddress);
    const linkedId = linked === null ? null : entryAnchor(linked.entry.id);
    if (linkedId === null) {
      clearHighlight();
    }
    if (isReturnVisit()) {
      setRowRequest({ linkedId, returning: true, openIds: rememberedRows() });
    } else {
      setRowRequest({ linkedId, returning: false, openIds: [] });
    }
  }

  // Only the hash changed, such as a link to another row. The other rows
  // stay as they are.
  function followHash() {
    knownAddress.current = currentAddress();
    const row = findRow(rows, rowIdFromHash());
    const returning = isReturnVisit();
    if (row === null) {
      clearHighlight();
      if (returning) {
        setRowRequest({ linkedId: null, returning, openIds: rememberedRows() });
      }
      return;
    }
    const id = entryAnchor(row.entry.id);
    // Its row is hidden by the search or a filter: show everything first.
    if (document.getElementById(id) === null) {
      changeSearch(NO_EVIDENCE_SEARCH);
    }
    setRowRequest({ linkedId: id, returning, openIds: returning ? rememberedRows() : null });
  }

  // A link or Back that stayed on this page changed the address: a new query
  // string is followed in full, a new hash just for its row.
  function onAddressChange() {
    const known = knownAddress.current;
    if (known === null) {
      return;
    }
    const address = currentAddress();
    if (address.search === known.search && address.hash === known.hash) {
      return;
    }
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

  // On arrival, follow the address (only possible after hydration, since the
  // server-rendered list is the unfiltered one). After that, follow hash
  // changes and keep the open rows on the history entry.
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

  const words = splitQuery(search.query);
  // The search applies to every count below, so it runs once.
  const searched: EvidenceRowData[] = [];
  for (const row of rows) {
    if (words.length === 0 || matchesWords(searchText(row), words)) {
      searched.push(row);
    }
  }

  // Each select counts its options against the search and the other selects.
  function optionsFor(name: EvidenceFilterName): FilterOption[] {
    const context = searched.filter((row) => matchesFilters(row.entry, search, name));
    return optionsWithCounts(context, name, options[name], search[name]);
  }

  const visible = searched.filter((row) => matchesFilters(row.entry, search, null));
  const activeFilters = countActiveFilters(search);
  const isFiltered = words.length > 0 || activeFilters > 0;

  // A chip under the folded "Filters" button turns its select back to all.
  // The chip goes away, so focus moves to the button above it.
  function removeFilter(key: string) {
    for (const name of FILTER_NAMES) {
      if (name === key) {
        changeSearch({ ...search, [name]: ALL });
      }
    }
    filtersToggleRef.current?.focus();
  }

  function clearFilters() {
    changeSearch(NO_EVIDENCE_SEARCH);
    // The button just used goes away with the filters. Moving focus to the
    // results heading keeps screen readers in place.
    resultsHeadingRef.current?.focus({ preventScroll: true });
  }

  // Enter, or the Search key on a phone keyboard: brings the results into
  // view when they're off screen, closing the phone keyboard.
  function showResults(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bar = resultsBarRef.current;
    if (bar === null) {
      return;
    }
    const view = window.visualViewport;
    const viewTop = view ? view.offsetTop : 0;
    const viewBottom = view ? view.offsetTop + view.height : window.innerHeight;
    const barBox = bar.getBoundingClientRect();
    if (barBox.top >= viewTop && barBox.bottom + FIRST_ROW_PEEK <= viewBottom) {
      return;
    }
    searchRef.current?.blur();
    bar.scrollIntoView({ block: "start" });
  }

  return (
    <div ref={databaseRef} className={sourceStyles.database}>
      {/* Its own Suspense boundary, so the static export still prerenders the list. */}
      <Suspense fallback={null}>
        <AddressWatcher onChange={onAddressChange} />
      </Suspense>

      <form
        className={`${sourceStyles.filters} ${styles.filters}`}
        role="search"
        aria-label="Filter entries"
        onSubmit={showResults}
      >
        <div className={`${sourceStyles.control} ${sourceStyles.searchControl} ${styles.search}`}>
          <label htmlFor="evidence-search" className={sourceStyles.label}>
            Search
          </label>
          <div className={sourceStyles.searchWrap}>
            <SearchIcon />
            <input
              ref={searchRef}
              id="evidence-search"
              type="search"
              className={sourceStyles.input}
              placeholder="Claim, ID, code or source"
              autoComplete="off"
              enterKeyHint="search"
              value={search.query}
              onChange={(event) => changeSearch({ ...search, query: event.target.value })}
            />
          </div>
        </div>

        {/* On phones the selects fold behind this button, as on the sources page. */}
        <button
          ref={filtersToggleRef}
          type="button"
          className={sourceStyles.filtersToggle}
          aria-expanded={filtersOpen}
          aria-controls="evidence-filter-selects"
          aria-label={activeFilters > 0 ? `Filters, ${activeFilters} active` : "Filters"}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          {activeFilters > 0 ? `Filters (${activeFilters})` : "Filters"}
          <span className={sourceStyles.filtersChevron} aria-hidden="true" />
        </button>

        {!filtersOpen && (
          <ActiveFilterChips
            chips={activeFilterList(search, options).map((filter) => ({
              key: filter.name,
              filter: FILTER_LABELS[filter.name],
              value: filter.label,
            }))}
            onRemove={removeFilter}
          />
        )}

        <div
          id="evidence-filter-selects"
          className={`${sourceStyles.selects} ${filtersOpen ? sourceStyles.selectsOpen : ""}`}
        >
          <FilterSelect
            id="evidence-family"
            label={FILTER_LABELS.family}
            allLabel="All families"
            value={search.family}
            options={optionsFor("family")}
            onChange={(value) => changeSearch({ ...search, family: value })}
          />
          <FilterSelect
            id="evidence-feeds"
            label={FILTER_LABELS.feeds}
            allLabel="All ratings"
            value={search.feeds}
            options={optionsFor("feeds")}
            onChange={(value) => changeSearch({ ...search, feeds: value })}
          />
          <FilterSelect
            id="evidence-role"
            label={FILTER_LABELS.role}
            allLabel="All roles"
            value={search.role}
            options={optionsFor("role")}
            onChange={(value) => changeSearch({ ...search, role: value })}
          />
          <FilterSelect
            id="evidence-source"
            label={FILTER_LABELS.source}
            allLabel="All sources"
            value={search.source}
            options={optionsFor("source")}
            onChange={(value) => changeSearch({ ...search, source: value })}
          />
        </div>
      </form>

      {search.family === CROSS_FAMILY && crossFamilyNote}

      <div ref={resultsBarRef} className={`${sourceStyles.resultsBar} ${styles.resultsBar}`}>
        <p className={sourceStyles.count} aria-live="polite">
          {visible.length === rows.length
            ? `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`
            : `${visible.length} of ${rows.length} entries`}
        </p>
        {/* With nothing found, the empty state below has its own button. */}
        {isFiltered && visible.length > 0 && (
          <button type="button" className={sourceStyles.clear} onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <section aria-labelledby="evidence-results-heading">
        <h2 id="evidence-results-heading" ref={resultsHeadingRef} tabIndex={-1} className="visually-hidden">
          Matching entries
        </h2>
        {visible.length > 0 ? (
          <ul ref={listRef} className={sourceStyles.list}>
            {visible.map((row) => (
              <li key={row.entry.id}>
                <EvidenceRow row={row} index={index} />
              </li>
            ))}
          </ul>
        ) : (
          <div className={`paper ${sourceStyles.empty}`}>
            <p className={sourceStyles.emptyTitle}>
              Nothing matches <em>that</em> yet.
            </p>
            {words.length > 0 && <p className={sourceStyles.emptyText}>Try fewer words.</p>}
            <button type="button" className="btn btn-secondary" onClick={clearFilters}>
              Show all entries
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

interface FilterSelectProps {
  id: string;
  label: string;
  allLabel: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

// One labelled select. Each option shows how many rows picking it would leave.
function FilterSelect({ id, label, allLabel, value, options, onChange }: FilterSelectProps) {
  return (
    <div className={sourceStyles.control}>
      <label htmlFor={id} className={sourceStyles.label}>
        {label}
      </label>
      <div className={sourceStyles.selectWrap}>
        <select
          id={id}
          className={sourceStyles.select}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value={ALL}>{allLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label} ({option.count})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
