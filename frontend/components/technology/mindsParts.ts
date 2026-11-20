// The artificial minds facets, in the order the pages show them, built from
// the workbook's "4.1 Artificial Minds" rows (artificial_minds_by_stage). The
// technology page's #minds section uses this. Pure, no React
// (tests/mindsFacets.test.ts).
import type { ArtificialMindsStage } from "@/lib/types";

export type MindsFacetKey = "consciousness" | "moral_status" | "identity" | "welfare" | "protections";

// Each label names the tab's column, reworded to read as a heading
// ("Moral status grounded in" -> "Grounds for moral status"). The compare
// page's MINDS_FACETS (compareModel.ts) uses the same labels.
export const MINDS_FACETS: { key: MindsFacetKey; label: string }[] = [
  { key: "consciousness", label: "Consciousness" },
  { key: "moral_status", label: "Grounds for moral status" },
  { key: "identity", label: "Identity, copying and modification" },
  { key: "welfare", label: "Welfare harms or benefits" },
  { key: "protections", label: "Proposed protections" },
];

// One stage's cell under one facet.
export interface MindsStatement {
  // The tab's Stage cell word for word ("3 Whole brain emulation (one
  // instance)"). Used only as a key; readers never see the number.
  stageLabel: string;
  // The same cell without its leading number, used as the statement's heading
  // ("Whole brain emulation (one instance)"). "All stages" has no number and
  // stays as it is.
  heading: string;
  text: string;
}

export interface MindsFacet {
  key: MindsFacetKey;
  label: string;
  statements: MindsStatement[]; // stage order, only the stages with text
}

// "3 Whole brain emulation (one instance)" -> "Whole brain emulation (one instance)".
export function stageHeading(stageLabel: string): string {
  const stripped = stageLabel.replace(/^\d+\s+/, "");
  return stripped === "" ? stageLabel : stripped;
}

// All five facets in order, each with the stages that have text for it.
export function mindsFacets(stages: ArtificialMindsStage[]): MindsFacet[] {
  return MINDS_FACETS.map(({ key, label }) => {
    const statements: MindsStatement[] = [];
    for (const stage of stages) {
      const text = stage[key];
      if (typeof text === "string" && text.trim() !== "") {
        statements.push({ stageLabel: stage.stage_label, heading: stageHeading(stage.stage_label), text });
      }
    }
    return { key, label, statements };
  });
}

// The labels of the facets no stage has text for, in facet order.
export function emptyFacetLabels(facets: MindsFacet[]): string[] {
  return facets.filter((facet) => facet.statements.length === 0).map((facet) => facet.label);
}

// The stages that name sources or evidence entries, for the small table
// under the facet cards. Stage order.
export function stagesWithReferences(stages: ArtificialMindsStage[]): ArtificialMindsStage[] {
  return stages.filter((stage) => (stage.source_ids ?? []).length > 0 || (stage.entries ?? []).length > 0);
}
