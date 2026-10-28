import type { Metadata } from "next";

import { MilestoneList } from "@/components/admin/MilestoneList";

export const metadata: Metadata = { title: "Milestones" };

export default function AdminMilestonesPage() {
  return <MilestoneList />;
}
