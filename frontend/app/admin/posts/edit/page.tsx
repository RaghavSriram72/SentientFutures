import type { Metadata } from "next";
import { Suspense } from "react";

import { PostEditor } from "@/components/admin/PostEditor";

export const metadata: Metadata = { title: "Edit a post" };

// The post comes from ?slug= (none for a new post), so the view sits inside
// Suspense for the static export.
export default function AdminEditPostPage() {
  return (
    <Suspense fallback={null}>
      <PostEditor />
    </Suspense>
  );
}
