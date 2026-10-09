"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings", label: "Profile" },
  { href: "/settings/sharing", label: "Sharing" },
  { href: "/settings/appearance", label: "Appearance" },
  { href: "/settings/away", label: "Away" },
  { href: "/settings/linear", label: "Linear" },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Settings">
      {TABS.map((t) => (
        <Link key={t.href} className="tab" href={t.href} aria-current={path === t.href ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
