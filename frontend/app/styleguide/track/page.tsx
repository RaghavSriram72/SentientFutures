import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TrackScene } from "@/components/timeline3d/TrackScene";
import { getSiteData } from "@/lib/data";
import { sourceRefsById } from "@/lib/sources";

export const metadata: Metadata = {
  title: "Track specimen",
  robots: { index: false, follow: false },
};

// The 3D track with the worked examples switched on, so the style tile can
// show every mark (ribbons, forecast lines, the Never zone, a disagreement
// stamp and dependency links) before the real milestones have them. It only
// exists under `next dev`: a production build gets "not found" here, before
// any data is read, so the samples never reach the published site.
export default function TrackSpecimenPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  const data = getSiteData();
  return <TrackScene milestones={data.milestones} sources={sourceRefsById(data.sources)} nowYear={data.nowYear} includeSamples />;
}
