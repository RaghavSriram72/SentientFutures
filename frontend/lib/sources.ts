import type { Source } from "./types";

// The small slice of a Source that citations need. Client components get this
// instead of the full record to keep page payloads small.
export interface SourceRef {
  id: string;
  title: string;
  authors: string[];
  year: number;
  url: string;
  sample?: boolean;
}

export function toSourceRef(source: Source): SourceRef {
  return {
    id: source.id,
    title: source.title,
    authors: source.authors,
    year: source.year,
    url: source.url,
    sample: source.sample,
  };
}

export function sourceRefsById(sources: Source[]): Record<string, SourceRef> {
  const map: Record<string, SourceRef> = {};
  for (const source of sources) {
    map[source.id] = toSourceRef(source);
  }
  return map;
}

function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

// "Sandberg 2008", "Sandberg & Bostrom 2008", "Sandberg et al. 2008"
export function shortCitation(source: SourceRef): string {
  const authors = source.authors;
  let who = "Unknown";
  if (authors.length === 1) {
    who = lastName(authors[0]);
  } else if (authors.length === 2) {
    who = `${lastName(authors[0])} & ${lastName(authors[1])}`;
  } else if (authors.length > 2) {
    who = `${lastName(authors[0])} et al.`;
  }
  return `${who} ${source.year}`;
}
