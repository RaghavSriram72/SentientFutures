import type { Metadata } from "next";

import { DashboardView } from "@/components/admin/DashboardView";

// The admin layout's "%s | Team admin" template only reaches pages below it,
// so this page, at the layout's own level, spells out its full title.
export const metadata: Metadata = { title: { absolute: "Dashboard | Team admin" } };

export default function AdminDashboardPage() {
  return <DashboardView />;
}
