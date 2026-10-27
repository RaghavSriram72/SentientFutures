import type { Metadata } from "next";

import { TechnologyPageView } from "@/components/technology/TechnologyPageView";
import { technologyMetadata } from "@/components/technology/technologyData";

export const metadata: Metadata = technologyMetadata("wbe");

export default function WbePage() {
  return <TechnologyPageView id="wbe" />;
}
