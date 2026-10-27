import type { Source } from "./types";

// The small slice of a Source that citations need. Client components get this
// instead of the full record to keep page payloads small.
export interface SourceRef {
  id: string;
  register_id: string | null; // the team's evidence register id, e.g. "S02"
  title: string;
  authors: string[];
  year: number;
  url: string;
  venue: string | null;
  sample?: boolean;
}

export function toSourceRef(source: Source): SourceRef {
  return {
    id: source.id,
    register_id: source.register_id ?? null,
    title: source.title,
    authors: source.authors,
    year: source.year,
    url: source.url,
    venue: source.venue ?? null,
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

// "S02" -> its source, for the evidence register, which cites by register id.
export function sourceRefsByRegisterId(sources: Source[]): Record<string, SourceRef> {
  const map: Record<string, SourceRef> = {};
  for (const source of sources) {
    if (source.register_id) {
      map[source.register_id] = toSourceRef(source);
    }
  }
  return map;
}

// The sources the team actually collected, without the fictional samples.
export function realSources(sources: Source[]): Source[] {
  const real: Source[] = [];
  for (const source of sources) {
    if (!source.sample) {
      real.push(source);
    }
  }
  return real;
}

// "S02" -> 2. Sources without a register id sort after the rest.
function registerNumber(source: Source): number {
  if (!source.register_id) {
    return Number.MAX_SAFE_INTEGER;
  }
  const number = parseInt(source.register_id.slice(1), 10);
  return Number.isNaN(number) ? Number.MAX_SAFE_INTEGER : number;
}

// S01 first, in the same order as the team's scouting database.
export function sortByRegisterId(sources: Source[]): Source[] {
  const sorted = [...sources];
  sorted.sort((a, b) => {
    const difference = registerNumber(a) - registerNumber(b);
    if (difference !== 0) {
      return difference;
    }
    return a.title.localeCompare(b.title);
  });
  return sorted;
}

// Words that mark an author as an organization, whose name is cited whole
// ("Foresight Institute 2024", not "Institute 2024").
const ORGANIZATION_WORDS = [
  "institute",
  "forum",
  "foundation",
  "center",
  "centre",
  "university",
  "lab",
  "labs",
  "society",
  "council",
  "association",
  "project",
];

function isOrganization(name: string): boolean {
  for (const word of name.toLowerCase().split(/\s+/)) {
    if (ORGANIZATION_WORDS.includes(word)) {
      return true;
    }
  }
  return false;
}

function lastName(fullName: string): string {
  if (isOrganization(fullName)) {
    return fullName.trim();
  }
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

const SHORT_TITLE_WORDS = 5;

// "Deep reinforcement learning from error-related potentials" -> "Deep reinforcement learning from error-related…"
function shortTitle(title: string): string {
  const words = title.trim().split(/\s+/);
  if (words.length <= SHORT_TITLE_WORDS) {
    return title.trim();
  }
  const kept: string[] = [];
  for (let i = 0; i < SHORT_TITLE_WORDS; i++) {
    kept.push(words[i]);
  }
  // Drop punctuation the cut left behind, as in "Values and acausal reasoning:"
  return `${kept.join(" ").replace(/[,:;.]+$/, "")}…`;
}

// "Sandberg 2008", "Sandberg & Bostrom 2008", "Sandberg et al. 2008".
// Without authors: "LessWrong 2021", or the start of the title and the year.
export function shortCitation(source: SourceRef): string {
  const authors = source.authors;
  let who = "";
  if (authors.length === 1) {
    who = lastName(authors[0]);
  } else if (authors.length === 2) {
    who = `${lastName(authors[0])} & ${lastName(authors[1])}`;
  } else if (authors.length > 2) {
    who = `${lastName(authors[0])} et al.`;
  } else if (source.venue) {
    who = source.venue;
  } else {
    who = shortTitle(source.title);
  }
  return `${who} ${source.year}`;
}
