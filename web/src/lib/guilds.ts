/**
 * Guilds (spec §5): admins create them and put people in them. A guild shares
 * one pooled quest a week.
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { guilds, users, type User } from "@/db/schema";
import { getViewer } from "@/lib/viewer";

/** The signed-in admin, or a 401/403 response to return. */
export async function requireAdmin(): Promise<User | NextResponse> {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (viewer.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  return viewer;
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "guild";
}

/** A slug no other guild uses: "core", then "core-2", "core-3"… */
export async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await db.query.guilds.findFirst({ where: eq(guilds.slug, slug), columns: { id: true } }))) return slug;
  }
}

export async function setGuild(userId: string, guildId: string | null): Promise<boolean> {
  const updated = await db.update(users).set({ guildId }).where(eq(users.id, userId)).returning({ id: users.id });
  return updated.length > 0;
}
