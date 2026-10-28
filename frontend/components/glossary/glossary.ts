// One-line definitions for the terms readers are least likely to know. A page
// wraps the first use of each in <Term>, which shows the line on hover or focus.
import { INTELLIGENCE_CURSE_DEFINITION } from "@/components/common/keyTerms";

export type GlossaryName = "intelligence-curse" | "comparator" | "directness" | "independence";

export const GLOSSARY: Record<GlossaryName, string> = {
  "intelligence-curse": INTELLIGENCE_CURSE_DEFINITION,
  comparator: "The alternative a proposal is measured against.",
  directness: "How close a piece of evidence comes to the scenario being assessed: direct, adjacent or remote.",
  independence: "Whether the author or funder has a stake in the result.",
};
