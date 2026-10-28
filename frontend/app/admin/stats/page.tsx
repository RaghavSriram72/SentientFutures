import type { Metadata } from "next";

import { StatsView } from "@/components/admin/StatsView";

export const metadata: Metadata = { title: "Review stats" };

export default function AdminStatsPage() {
  return <StatsView />;
}
