import type { Metadata } from "next";

import { TechnologyPageView } from "@/components/technology/TechnologyPageView";
import { technologyMetadata } from "@/components/technology/technologyData";

export const metadata: Metadata = technologyMetadata("neuromorphic");

export default function NeuromorphicPage() {
  return <TechnologyPageView id="neuromorphic" />;
}
