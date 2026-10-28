import type { Metadata } from "next";
import { Suspense } from "react";

import { MilestoneEditor } from "@/components/admin/MilestoneEditor";

export const metadata: Metadata = { title: "Edit a milestone" };

// The milestone comes from ?id= (none for a new one), so the view sits inside
// Suspense for the static export.
export default function AdminEditMilestonePage() {
  return (
    <Suspense fallback={null}>
      <MilestoneEditor />
    </Suspense>
  );
}
