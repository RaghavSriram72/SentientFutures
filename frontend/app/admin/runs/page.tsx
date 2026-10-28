import type { Metadata } from "next";
import { Suspense } from "react";

import { RunDetailView } from "@/components/admin/RunDetailView";

export const metadata: Metadata = { title: "Pipeline run" };

// The run id comes from ?id=, which only exists in the browser, so the view
// sits inside Suspense for the static export.
export default function AdminRunPage() {
  return (
    <Suspense fallback={null}>
      <RunDetailView />
    </Suspense>
  );
}
