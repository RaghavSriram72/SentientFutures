// Server-only helpers for the three technology pages. They read content through
// lib/data.ts, so only import this from server components and route files.
import type { Metadata } from "next";

import { getTechnologies, getTechnology } from "@/lib/data";
import type { TechnologyPage } from "@/lib/types";

export type TechnologyId = TechnologyPage["id"];

// Each route asks for a fixed id, so a missing record is a content mistake.
// Failing the build with a clear message beats publishing an empty page.
export function requireTechnology(id: TechnologyId): TechnologyPage {
  const technology = getTechnology(id);
  if (!technology) {
    throw new Error(`content/technologies.json has no record with id "${id}".`);
  }
  return technology;
}

// "01", "02", "03": the page's position in technologies.json.
export function technologyNumber(id: TechnologyId): string {
  const technologies = getTechnologies();
  for (let index = 0; index < technologies.length; index++) {
    if (technologies[index].id === id) {
      return String(index + 1).padStart(2, "0");
    }
  }
  return "00";
}

// The page after this one, wrapping round to the first, for the link at the
// bottom of each page. null when there is only one technology.
export function nextTechnology(id: TechnologyId): TechnologyPage | null {
  const technologies = getTechnologies();
  if (technologies.length < 2) {
    return null;
  }
  for (let index = 0; index < technologies.length; index++) {
    if (technologies[index].id === id) {
      return technologies[(index + 1) % technologies.length];
    }
  }
  return null;
}

export function technologyMetadata(id: TechnologyId): Metadata {
  const technology = requireTechnology(id);
  return {
    title: technology.name,
    description: technology.intro.text,
  };
}
