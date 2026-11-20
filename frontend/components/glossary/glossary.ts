// One-line definitions for the terms readers are least likely to know. A page
// wraps the first use of each in <Term>, which shows the line on hover or focus.
import { INTELLIGENCE_CURSE_DEFINITION } from "@/components/common/keyTerms";
import { enumDescription, enumValues } from "@/lib/enums";

export type GlossaryName =
  | "alignment"
  | "intelligence-curse"
  | "not-claimed"
  | "comparator"
  | "directness"
  | "independence";

// The workbook's four directness values, each with its Codebook definition
// word for word (the EvidenceDirectness labels and descriptions in enums.json
// are the Codebook's text). Middle dots keep the items apart without adding
// punctuation to the definitions, as milestoneTypeCategoriesText does.
function directnessLine(): string {
  const items: string[] = [];
  for (const info of enumValues("EvidenceDirectness")) {
    items.push(info.description ? `${info.label}: ${info.description}` : info.label);
  }
  return `How close a piece of evidence comes to the technology family. ${items.join(" · ")}`;
}

export const GLOSSARY: Record<GlossaryName, string> = {
  // The same line as the home page's key terms strip, from the Problem category.
  alignment: enumDescription("Problem", "alignment"),
  "intelligence-curse": INTELLIGENCE_CURSE_DEFINITION,
  // Also the grading key's note on the Not claimed chip (Scorecard). The
  // apostrophe is curly, like the key's other lines and the site's JSX text.
  "not-claimed": "The proposal doesn’t claim this outcome, so there is no case to grade.",
  comparator: "The alternative a proposal is measured against.",
  directness: directnessLine(),
  independence: "Whether the author or funder has a stake in the result.",
};
