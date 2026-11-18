// Labels and descriptions for every category, read from the shared enums.json.
// Never copy values into the frontend by hand: edit shared/sf_shared/enums.py instead.
import enumsJson from "./generated/enums.json";
import type { MilestoneCategory, MilestoneType } from "./types";

export type EnumName = keyof typeof enumsJson.enums;

interface EnumValueInfo {
  value: string;
  label: string;
  description: string;
}

export const RUBRIC_VERSION: string = enumsJson.rubric_version;

export function enumValues(name: EnumName): EnumValueInfo[] {
  return enumsJson.enums[name].values;
}

export function isDraftEnum(name: EnumName): boolean {
  return enumsJson.enums[name].draft;
}

function findValue(name: EnumName, value: string): EnumValueInfo | undefined {
  for (const info of enumsJson.enums[name].values) {
    if (info.value === value) {
      return info;
    }
  }
  return undefined;
}

export function enumLabel(name: EnumName, value: string): string {
  const info = findValue(name, value);
  return info ? info.label : value;
}

export function enumDescription(name: EnumName, value: string): string {
  const info = findValue(name, value);
  return info ? info.description : "";
}

export function allEnumNames(): EnumName[] {
  return Object.keys(enumsJson.enums) as EnumName[];
}

// ---------- Milestone types ----------
// Each milestone category belongs to one of three types (MILESTONE_TYPES in
// enums.py). A milestone's type is worked out from its category, never stored.

export interface MilestoneTypeInfo {
  value: MilestoneType;
  label: string; // "Technical", "Deployment" or "Welfare and governance"
  categories: MilestoneCategory[];
}

// Read loosely, so a local copy of enums.json from before the types existed
// still compiles and simply has none (run npm run sync to refresh it). The
// "as" matters: a plain type annotation fails to compile against that copy.
const typesFile = enumsJson as { milestone_types?: unknown[] };

// The three types, in order, each with its categories in order.
export function milestoneTypes(): MilestoneTypeInfo[] {
  return (typesFile.milestone_types ?? []) as MilestoneTypeInfo[];
}

// The type a category belongs to, or null with a stale copy of enums.json.
// Callers then show no type mark, and never throw.
export function milestoneTypeOf(category: string): MilestoneTypeInfo | null {
  for (const info of milestoneTypes()) {
    for (const member of info.categories) {
      if (member === category) {
        return info;
      }
    }
  }
  return null;
}

// "Technical capability · High-level fidelity · Reliability and robustness".
// The middle dot keeps the comma inside "Scalable manufacture, compute or data" readable.
export function milestoneTypeCategoriesText(info: MilestoneTypeInfo): string {
  const labels: string[] = [];
  for (const category of info.categories) {
    labels.push(enumLabel("MilestoneCategory", category));
  }
  return labels.join(" · ");
}
