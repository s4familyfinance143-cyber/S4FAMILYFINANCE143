"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";
import { adminCopy } from "@/lib/adminCopy";

const items = [
  ["/admin/dashboard", "navDashboard"],
  ["/admin/posts", "navPosts"],
  ["/admin/customers", "navCustomers"],
  ["/admin/tickets", "navTickets"],
  ["/admin/licenses", "navLicenses"],
  ["/admin/orders", "navOrders"],
  ["/admin/payments", "navPayments"],
  ["/admin/purchases", "navPurchases"],
  ["/admin/releases", "navReleases"],
  ["/admin/activity", "navActivity"],
] as const;

export function AdminNav() {
  const pathname = usePathname();
  const { lang } = useI18n();
  const copy = adminCopy[lang] ?? adminCopy.en;

  return (
    <nav className="flex flex-wrap gap-2 rounded-2xl border border-line bg-white/[0.02] p-2">
      {items.map(([href, labelKey]) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
              active
                ? "bg-accent text-bg"
                : "text-muted hover:bg-panel/60 hover:text-text"
            }`}
          >
            {copy[labelKey]}
          </Link>
        );
      })}
    </nav>
  );
}
