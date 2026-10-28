import type { Metadata } from "next";

import { SettingsView } from "@/components/admin/SettingsView";

export const metadata: Metadata = { title: "Search settings" };

export default function AdminSettingsPage() {
  return <SettingsView />;
}
