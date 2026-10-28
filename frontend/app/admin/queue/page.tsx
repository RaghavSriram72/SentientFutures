import type { Metadata } from "next";
import { Suspense } from "react";

import { QueueView } from "@/components/admin/QueueView";

export const metadata: Metadata = { title: "Review queue" };

// The tab and filters live in the query string, so the view sits inside
// Suspense for the static export.
export default function AdminQueuePage() {
  return (
    <Suspense fallback={null}>
      <QueueView />
    </Suspense>
  );
}
