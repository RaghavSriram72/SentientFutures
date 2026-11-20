import type { Metadata } from "next";
import type { ReactNode } from "react";

import { compareDimensions } from "@/components/compare/compareModel";
import { ComparePanel } from "@/components/compare/ComparePanels";
import { CompareView } from "@/components/compare/CompareView";
import { EmphasisText } from "@/components/common/Emphasis";
import { PageHeader } from "@/components/common/PageHeader";
import { MarksHelp, type MarksCodeRanges } from "@/components/provenance/MarksHelp";
import { idRange } from "@/components/technology/sections/pageModel";
import { buildTimeline } from "@/components/timeline/timelineModel";
import { buildCodeIndex } from "@/lib/codes";
import { getPublicMilestones, getScorecard, getSiteData, getSources, getTechnologies } from "@/lib/data";
import { realSources, sourceRefsById, toSourceRef } from "@/lib/sources";
import type { ScorecardData, Source } from "@/lib/types";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Compare",
  description:
    "Whole brain emulation, brain-computer interfaces and neuromorphic AI side by side, one dimension at a time.",
};

// The three technologies on one dimension at a time: a scorecard row, the
// artificial minds statements, or a milestone category. Every panel is built
// here at build time, and CompareView shows the one the address asks for
// (/compare/?dimension=<key>). The rating cards and the home page link here
// with a dimension already picked.
export default function ComparePage() {
  const technologies = getTechnologies();
  const dimensions = compareDimensions(technologies);
  // The timeline's own grouping, so each milestone has the code it has there.
  // Sample milestones never appear: getPublicMilestones() leaves them out.
  const groups = buildTimeline(getPublicMilestones(), getSiteData().nowYear);
  const allSources = getSources();
  const sources = sourceRefsById(allSources);
  // The workbook's tables, and where each code in its text links.
  const scorecard = getScorecard();
  const codeIndex = buildCodeIndex(scorecard, allSources.map(toSourceRef));

  const panels: Record<string, ReactNode> = {};
  for (const dimension of dimensions) {
    panels[dimension.key] = (
      <ComparePanel
        dimension={dimension}
        technologies={technologies}
        groups={groups}
        sources={sources}
        scorecard={scorecard}
        codeIndex={codeIndex}
      />
    );
  }

  return (
    <>
      <PageHeader
        compact
        eyebrow="Compare"
        title={<EmphasisText text="The three technologies, *side by side*" />}
        lede="Pick a dimension to see where each one stands on it."
      />

      <div className={`container ${styles.body}`}>
        <CompareView
          dimensions={dimensions}
          panels={panels}
          marks={<MarksHelp codes={codeRanges(scorecard, allSources)} />}
        />
      </div>
    </>
  );
}

// The first and last entry and source codes, for the marks help, as on the
// technology pages. No stage lines: the panels show all three families, and
// each family has its own stage codes.
function codeRanges(scorecard: ScorecardData, sources: Source[]): MarksCodeRanges {
  const entryIds = (scorecard.entries ?? []).map((entry) => entry.id);
  const registerIds: string[] = [];
  for (const source of realSources(sources)) {
    if (source.register_id) {
      registerIds.push(source.register_id);
    }
  }
  return { entries: idRange(entryIds), sources: idRange(registerIds) };
}
