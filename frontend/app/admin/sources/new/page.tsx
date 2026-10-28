import type { Metadata } from "next";

import { AddSourceView } from "@/components/admin/AddSourceView";

export const metadata: Metadata = { title: "Add a source" };

export default function AdminAddSourcePage() {
  return <AddSourceView />;
}
