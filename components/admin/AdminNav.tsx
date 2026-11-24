"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminNav({ signOut }: { signOut: () => Promise<void> }) {
  const path = usePathname();
  const tab = (href: string, label: string) => {
    const active = href === "/admin" ? path === "/admin" : path.startsWith(href);
    return (
      <Link
        href={href}
        className={`flex h-11 shrink-0 items-center rounded-lg px-3 text-base font-semibold ${
          active ? "bg-white text-brand-700" : "text-white"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav className="sticky top-0 z-20 flex items-center gap-1 overflow-x-auto bg-brand-600 px-2 py-2">
      {tab("/admin", "Orders")}
      {tab("/admin/settings", "Settings")}
      {tab("/admin/coupons", "Coupons")}
      {tab("/admin/feedback", "Feedback")}
      <form action={signOut} className="ml-auto shrink-0">
        <button className="h-11 px-2 text-sm text-brand-100">Sign out</button>
      </form>
    </nav>
  );
}
