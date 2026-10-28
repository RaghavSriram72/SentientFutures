import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/AdminShell";

// Admin stays out of search engines even after launch. Every page below is
// rendered in the browser, after sign-in, from the API.
export const metadata: Metadata = {
  title: { default: "Team admin", template: "%s | Team admin" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
