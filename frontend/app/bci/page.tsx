import type { Metadata } from "next";

import { TechnologyPageView } from "@/components/technology/TechnologyPageView";
import { technologyMetadata } from "@/components/technology/technologyData";

export const metadata: Metadata = technologyMetadata("bci");

export default function BciPage() {
  return <TechnologyPageView id="bci" />;
}
