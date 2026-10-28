import type { Metadata } from "next";

import { TrackScene } from "@/components/timeline3d/TrackScene";
import { getPublicMilestones, getSiteData } from "@/lib/data";
import { realSources, sourceRefsById } from "@/lib/sources";

export const metadata: Metadata = {
  title: "Timeline",
  description:
    "When might the milestones for whole brain emulation, brain computer interfaces and neuromorphic AI happen? Every forecast is shown on its own, and milestones without a defensible date say so.",
};

// The timeline is a full-screen scene that covers the site header and footer.
// It's a client component; the data comes in as props from the build. Only
// real milestones and sources are passed in: the worked examples never reach
// the public site, not even in the page's data.
export default function TimelinePage() {
  const data = getSiteData();
  return (
    <TrackScene
      milestones={getPublicMilestones()}
      sources={sourceRefsById(realSources(data.sources))}
      nowYear={data.nowYear}
    />
  );
}
