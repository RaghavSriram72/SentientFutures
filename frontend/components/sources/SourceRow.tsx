import { enumLabel } from "@/lib/enums";
import type { SourceRef } from "@/lib/sources";
import type { Source, Technology } from "@/lib/types";

import { SourceDetails } from "./CatalogCard";
import { ClaimDirectionChip } from "./ClaimDirectionChip";
import styles from "./SourceRow.module.css";

// The short names the site's navigation uses, so a row's tags stay on one line.
const TECHNOLOGY_SHORT: Record<Technology, string> = {
  wbe: "Brain emulation",
  bci: "Brain interfaces",
  neuromorphic: "Neuromorphic AI",
  hybrid: "Hybrid",
};

// "Lisa Thiergart", "Cao & Xue", "Cao et al.", or "" when no authors are listed.
function shortAuthors(authors: string[]): string {
  if (authors.length === 0) {
    return "";
  }
  if (authors.length === 1) {
    return authors[0];
  }
  const lastNames: string[] = [];
  for (const name of authors) {
    const parts = name.trim().split(/\s+/);
    lastNames.push(parts[parts.length - 1]);
  }
  if (authors.length === 2) {
    return `${lastNames[0]} & ${lastNames[1]}`;
  }
  return `${lastNames[0]} et al.`;
}

// "Lisa Thiergart, 2023 · Talk", or "Psychology Today, 2026 · Blog" without authors.
function rowByline(source: Source): string {
  const who = shortAuthors(source.authors) || source.venue || "";
  const when = who ? `${who}, ${source.year}` : String(source.year);
  return `${when} · ${enumLabel("SourceType", source.source_type)}`;
}

interface SourceRowProps {
  source: Source;
  sources: Record<string, SourceRef>;
  sharedAddedBy: string | null;
  hideUnrated: boolean;
}

// One source as a single line of the list: id, title, byline and tags. It is a
// native <details>, so one click (or Enter) opens the full card underneath, and
// it carries the source's id so links like /sources/#s02 still land on it.
export function SourceRow({ source, sources, sharedAddedBy, hideUnrated }: SourceRowProps) {
  const directions = source.claim_directions ?? [];
  const isAiTechnology = source.ai_suggested_fields.includes("technology");

  return (
    <details id={source.id} className={styles.row}>
      <summary className={styles.summary}>
        <span className={styles.id}>{source.register_id ?? ""}</span>
        <span className={styles.main}>
          <span className={styles.title}>{source.title}</span>
          <span className={styles.byline}>{rowByline(source)}</span>
        </span>
        <span className={styles.tags}>
          {source.technology.length === 0 && <span className={`chip ${styles.tech}`}>General background</span>}
          {source.technology.map((technology) => (
            <span
              key={technology}
              className={`chip ${styles.tech} ${isAiTechnology ? styles.techAi : ""}`}
              title={enumLabel("Technology", technology)}
            >
              {TECHNOLOGY_SHORT[technology]}
            </span>
          ))}
          {directions.map((direction) => (
            <ClaimDirectionChip key={direction} direction={direction} />
          ))}
        </span>
        <span className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.body}>
        <SourceDetails source={source} sources={sources} sharedAddedBy={sharedAddedBy} hideUnrated={hideUnrated} />
      </div>
    </details>
  );
}
