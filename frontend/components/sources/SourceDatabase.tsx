"use client";

import Link from "next/link";
import { useState } from "react";

import { enumValues } from "@/lib/enums";
import { sourceRefsById } from "@/lib/sources";
import type { Source } from "@/lib/types";

import { CatalogCard } from "./CatalogCard";
import styles from "./SourceDatabase.module.css";

const ALL = "all";

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

// Every word has to appear somewhere in the title, authors or our summary.
function matchesWords(source: Source, words: string[]): boolean {
  if (words.length === 0) {
    return true;
  }
  const haystack = `${source.title} ${source.authors.join(" ")} ${source.summary.text}`.toLowerCase();
  for (const word of words) {
    if (!haystack.includes(word)) {
      return false;
    }
  }
  return true;
}

function hasTechnology(source: Source, technology: string): boolean {
  for (const value of source.technology) {
    if (value === technology) {
      return true;
    }
  }
  return false;
}

function countWithTechnology(sources: Source[], technology: string): number {
  let count = 0;
  for (const source of sources) {
    if (hasTechnology(source, technology)) {
      count += 1;
    }
  }
  return count;
}

function countWithKind(sources: Source[], kind: string): number {
  let count = 0;
  for (const source of sources) {
    if (source.kind === kind) {
      count += 1;
    }
  }
  return count;
}

// The searchable source list. Gets every approved source as a prop and filters
// in the browser; there are few enough that no index is needed.
export function SourceDatabase({ sources }: { sources: Source[] }) {
  const [query, setQuery] = useState("");
  const [technology, setTechnology] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  // So a summary that cites other sources keeps its citation links.
  const sourceRefs = sourceRefsById(sources);

  const words = splitQuery(query);
  const visible: Source[] = [];
  for (const source of sources) {
    if (technology !== ALL && !hasTechnology(source, technology)) {
      continue;
    }
    if (kind !== ALL && source.kind !== kind) {
      continue;
    }
    if (!matchesWords(source, words)) {
      continue;
    }
    visible.push(source);
  }

  const isFiltered = words.length > 0 || technology !== ALL || kind !== ALL;

  function clearFilters() {
    setQuery("");
    setTechnology(ALL);
    setKind(ALL);
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
              placeholder="Title, author or summary"
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
              {enumValues("Technology").map((info) => (
                <option key={info.value} value={info.value}>
                  {info.label} ({countWithTechnology(sources, info.value)})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.control}>
          <label htmlFor="source-kind" className={styles.label}>
            Kind
          </label>
          <div className={styles.selectWrap}>
            <select
              id="source-kind"
              className={styles.select}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value={ALL}>All kinds</option>
              {enumValues("SourceKind").map((info) => (
                <option key={info.value} value={info.value}>
                  {info.label} ({countWithKind(sources, info.value)})
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
          <ul className={styles.grid}>
            {visible.map((source) => (
              <li key={source.id}>
                <CatalogCard source={source} sources={sourceRefs} />
              </li>
            ))}
          </ul>
        ) : (
          <div className={`paper ${styles.empty}`}>
            <p className={styles.emptyTitle}>
              Nothing matches <em>that</em> yet.
            </p>
            <p className={styles.emptyText}>
              Try fewer words, or widen the technology or kind. If you know a source we should have,{" "}
              <Link href="/contact/">tell us about it</Link>.
            </p>
            <button type="button" className="btn btn-secondary" onClick={clearFilters}>
              Show every source
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
