// Build-time data loading. Only import this from server components (pages and
// layouts without "use client"). It reads DATA_DIR, which defaults to content/.
// The deploy points it at .site-data/, the folder the publish step writes
// (python -m sf_shared.export_site): content/ plus the sources, milestones and
// posts the team approved or published in admin. Both folders have the same
// layout (milestones.json, sources.json, technologies.json, posts/*.md).
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

import type { Milestone, Post, SiteData, Source, TechnologyPage } from "./types";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "..", "content");

function readJson<T>(fileName: string): T {
  const filePath = path.join(DATA_DIR, fileName);
  const text = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(text) as T;
}

// gray-matter turns an unquoted `date: 2026-10-26` into a Date object.
// Accept either form and always hand back "YYYY-MM-DD".
function toIsoDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value);
}

// A build reads each file once and keeps it. The dev server re-reads on every
// request instead, so edits to content/ show up on refresh without a restart.
const KEEP_IN_MEMORY = process.env.NODE_ENV === "production";

let cachedMilestones: Milestone[] | null = null;
let cachedSources: Source[] | null = null;
let cachedTechnologies: TechnologyPage[] | null = null;
let cachedPosts: Post[] | null = null;

export function getMilestones(): Milestone[] {
  if (cachedMilestones === null || !KEEP_IN_MEMORY) {
    cachedMilestones = readJson<Milestone[]>("milestones.json");
  }
  return cachedMilestones;
}

// The milestones readers see. Sample milestones are fictional worked examples
// for the content guide and tests; the public site never shows or counts them.
export function getPublicMilestones(): Milestone[] {
  const visible: Milestone[] = [];
  for (const milestone of getMilestones()) {
    if (!milestone.sample) {
      visible.push(milestone);
    }
  }
  return visible;
}

export function getSources(): Source[] {
  if (cachedSources === null || !KEEP_IN_MEMORY) {
    cachedSources = readJson<Source[]>("sources.json");
  }
  return cachedSources;
}

export function getTechnologies(): TechnologyPage[] {
  if (cachedTechnologies === null || !KEEP_IN_MEMORY) {
    cachedTechnologies = readJson<TechnologyPage[]>("technologies.json");
  }
  return cachedTechnologies;
}

export function getTechnology(id: string): TechnologyPage | undefined {
  for (const tech of getTechnologies()) {
    if (tech.id === id) {
      return tech;
    }
  }
  return undefined;
}

export function getPosts(): Post[] {
  if (cachedPosts === null || !KEEP_IN_MEMORY) {
    const postsDir = path.join(DATA_DIR, "posts");
    const posts: Post[] = [];
    for (const fileName of fs.readdirSync(postsDir)) {
      if (!fileName.endsWith(".md")) {
        continue;
      }
      const raw = fs.readFileSync(path.join(postsDir, fileName), "utf-8");
      const { data, content } = matter(raw);
      posts.push({
        slug: String(data.slug ?? fileName.replace(/\.md$/, "")),
        title: String(data.title),
        date: toIsoDate(data.date),
        author: String(data.author),
        summary: String(data.summary ?? ""),
        body: content,
      });
    }
    posts.sort((a, b) => (a.date < b.date ? 1 : -1));
    cachedPosts = posts;
  }
  return cachedPosts;
}

export function getPost(slug: string): Post | undefined {
  for (const post of getPosts()) {
    if (post.slug === slug) {
      return post;
    }
  }
  return undefined;
}

// Lookup tables so components can resolve ids quickly.
export function sourcesById(): Record<string, Source> {
  const map: Record<string, Source> = {};
  for (const source of getSources()) {
    map[source.id] = source;
  }
  return map;
}

export function milestonesById(): Record<string, Milestone> {
  const map: Record<string, Milestone> = {};
  for (const milestone of getMilestones()) {
    map[milestone.id] = milestone;
  }
  return map;
}

// "Now" is fixed at build time and passed down as a prop, so the server HTML
// and the browser always agree (no hydration mismatch).
export function getSiteData(): SiteData {
  const now = new Date();
  return {
    milestones: getMilestones(),
    sources: getSources(),
    technologies: getTechnologies(),
    posts: getPosts(),
    nowYear: now.getFullYear(),
    builtAt: now.toISOString(),
  };
}
