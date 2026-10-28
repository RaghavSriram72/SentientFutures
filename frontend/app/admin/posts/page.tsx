import type { Metadata } from "next";

import { PostList } from "@/components/admin/PostList";

export const metadata: Metadata = { title: "Blog posts" };

export default function AdminPostsPage() {
  return <PostList />;
}
