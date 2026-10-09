"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/quests", label: "Quests" },
  { href: "/achievements", label: "Achievements" },
  { href: "/compare", label: "Compare" },
  { href: "/xp", label: "XP" },
  { href: "/download", label: "Download" },
  { href: "/bugs", label: "Report a bug" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={(l.href === "/" ? path === "/" : path.startsWith(l.href)) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
