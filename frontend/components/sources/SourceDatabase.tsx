"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { enumValues } from "@/lib/enums";
import { sourceRefsById } from "@/lib/sources";
import type { Source } from "@/lib/types";

import styles from "./SourceDatabase.module.css";
import { SourceRow } from "./SourceRow";

const ALL = "all";
// Select values for the empty cases, which have no enum value of their own.
const GENERAL_BACKGROUND = "general";
const NEITHER = "neither";

// "brain  interface" -> ["brain", "interface"]
function splitQuery(query: string): string[] {
  const words: string[] = [];
  for (const part of query.toLowerCase().split(/\s+/)) {
    if (part !== "") {
      words.push(part);
    }
  }
  return words;
}

// Every word has to appear somewhere in the register id, title, authors,
// venue or the team's summary.
function matchesWords(source: Source, words: string[]): boolean {
  if (words.length === 0) {
    return true;
  }
  const haystack = [
    source.register_id ?? "",
    source.title,
    source.authors.join(" "),
    source.venue ?? "",
    source.summary.text,
  ]
    .join(" ")
    .toLowerCase();
  for (const word of words) {
    if (!haystack.includes(word)) {
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

function matchesDirection(source: Source, direction: string): boolean {
  for (const value of source.claim_directions ?? []) {
    if (value === direction) {
      return true;
    }
  }
  return false;
}

// problem is a select value: an enum value, or NEITHER for a null problem.
function matchesProblem(source: Source, problem: string): boolean {
  if (problem === NEITHER) {
    return source.problem === null;
  }
  return source.problem === problem;
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
}

// The options for one filter, with how many sources each would show. Options
// that would show nothing are left out, so the list never offers "Hybrid (0)".
function optionsWithCounts(
  sources: Source[],
  values: { value: string; label: string }[],
  matches: (source: Source, value: string) => boolean,
): FilterOption[] {
  const options: FilterOption[] = [];
  for (const info of values) {
    const count = countMatching(sources, (source) => matches(source, info.value));
    if (count > 0) {
      options.push({ value: info.value, label: info.label, count });
    }
  }
  return options;
}

// Opens the row a link points at, like /sources/#s02 from an evidence
// register. The browser scrolls to it; this makes sure it's open when it gets there.
function openRowFromHash() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (id === "") {
    return;
  }
  const row = document.getElementById(id);
  if (row instanceof HTMLDetailsElement && !row.open) {
    row.open = true;
    row.scrollIntoView({ block: "start" });
  }
}

interface SourceDatabaseProps {
  sources: Source[];
  // Passed on to each row: see CatalogCard's CardOptions.
  sharedAddedBy?: string | null;
  hideUnrated?: boolean;
}

// The searchable source list. Gets every source to show as a prop, already in
// order, and filters in the browser; there are few enough that no index is needed.
export function SourceDatabase({ sources, sharedAddedBy = null, hideUnrated = false }: SourceDatabaseProps) {
  const [query, setQuery] = useState("");
  const [technology, setTechnology] = useState(ALL);
  const [direction, setDirection] = useState(ALL);
  const [problem, setProblem] = useState(ALL);
  // So a summary that cites other sources keeps its citation links.
  const sourceRefs = sourceRefsById(sources);

  useEffect(() => {
    openRowFromHash();
    window.addEventListener("hashchange", openRowFromHash);
    return () => window.removeEventListener("hashchange", openRowFromHash);
  }, []);

  const technologyOptions = optionsWithCounts(
    sources,
    [...enumValues("Technology"), { value: GENERAL_BACKGROUND, label: "General background" }],
    matchesTechnology,
  );
  const directionOptions = optionsWithCounts(sources, enumValues("ClaimDirection"), matchesDirection);
  const problemOptions = optionsWithCounts(
    sources,
    [...enumValues("Problem"), { value: NEITHER, label: "Neither" }],
    matchesProblem,
  );

  const words = splitQuery(query);
  const visible: Source[] = [];
  for (const source of sources) {
    if (technology !== ALL && !matchesTechnology(source, technology)) {
      continue;
    }
    if (direction !== ALL && !matchesDirection(source, direction)) {
      continue;
    }
    if (problem !== ALL && !matchesProblem(source, problem)) {
      continue;
    }
    if (!matchesWords(source, words)) {
      continue;
    }
    visible.push(source);
  }

  const isFiltered = words.length > 0 || technology !== ALL || direction !== ALL || problem !== ALL;

  function clearFilters() {
    setQuery("");
    setTechnology(ALL);
    setDirection(ALL);
    setProblem(ALL);
  }

  return (
    <div className={styles.database}>
      <form className={styles.filters} role="search" aria-label="Filter sources" onSubmit={(event) => event.preventDefault()}>
        <div className={`${styles.control} ${styles.searchControl}`}>
          <label htmlFor="source-search" className={styles.label}>
            Search
          </label>
          <div className={styles.searchWrap}>
            <SearchIcon />
            <input
              id="source-search"
              type="search"
              className={styles.input}
              placeholder="Title, author, ID or summary"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className={styles.control}>
          <label htmlFor="source-technology" className={styles.label}>
            Technology
          </label>
          <div className={styles.selectWrap}>
            <select
              id="source-technology"
              className={styles.select}
              value={technology}
              onChange={(event) => setTechnology(event.target.value)}
            >
              <option value={ALL}>All technologies</option>
              {technologyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.control}>
          <label htmlFor="source-direction" className={styles.label}>
            Claim direction
          </label>
          <div className={styles.selectWrap}>
            <select
              id="source-direction"
              className={styles.select}
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
            >
              <option value={ALL}>All directions</option>
              {directionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.control}>
          <label htmlFor="source-problem" className={styles.label}>
            Problem
          </label>
          <div className={styles.selectWrap}>
            <select
              id="source-problem"
              className={styles.select}
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
            >
              <option value={ALL}>All problems</option>
              {problemOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>

      <div className={styles.resultsBar}>
        <p className={styles.count} aria-live="polite">
          {visible.length === sources.length
            ? `${sources.length} ${sources.length === 1 ? "source" : "sources"}`
            : `${visible.length} of ${sources.length} sources`}
        </p>
        {isFiltered && (
          <button type="button" className={styles.clear} onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <section aria-labelledby="source-results-heading">
        <h2 id="source-results-heading" className="visually-hidden">
          Matching sources
        </h2>
        {visible.length > 0 ? (
          <ul className={styles.list}>
            {visible.map((source) => (
              <li key={source.id}>
                <SourceRow
                  source={source}
                  sources={sourceRefs}
                  sharedAddedBy={sharedAddedBy}
                  hideUnrated={hideUnrated}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className={`paper ${styles.empty}`}>
            <p className={styles.emptyTitle}>
              Nothing matches <em>that</em> yet.
            </p>
            <p className={styles.emptyText}>
              Try fewer words or reset the filters. If you know a source we should have,{" "}
              <Link href="/contact/">tell us about it</Link>.
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

function SearchIcon() {
  return (
    <svg className={styles.searchIcon} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
