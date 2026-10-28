import type { Metadata } from "next";
import { Suspense } from "react";

import { ReviewView } from "@/components/admin/ReviewView";

export const metadata: Metadata = { title: "Review a paper" };

// The paper id comes from ?id=, so the view sits inside Suspense for the
// static export.
export default function AdminReviewPage() {
  return (
    <Suspense fallback={null}>
      <ReviewView />
    </Suspense>
  );
}
