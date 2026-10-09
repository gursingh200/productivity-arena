/**
 * Roles. Owner: one person, named by ARENA_OWNER_EMAIL in the deployment (not
 * the repo); everything an admin can do, plus making and removing admins.
 * Admin: guilds, guild admins, the Team page, all bug reports. Guild admin: a
 * member who can add people without a guild to their own guild and see its
 * stats. Sharing rules apply to everyone, owner included.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";

type Roleish = Pick<User, "role">;

export const isOwner = (u: Roleish) => u.role === "owner";
export const isAdmin = (u: Roleish) => u.role === "admin" || u.role === "owner";
export const isGuildAdmin = (u: Pick<User, "guildAdmin" | "guildId">) => u.guildAdmin && u.guildId !== null;

export function ownerEmail(env: Record<string, string | undefined> = process.env): string | null {
  return env.ARENA_OWNER_EMAIL?.trim().toLowerCase() || null;
}

/** Makes ARENA_OWNER_EMAIL the owner (once they've signed in); any other owner becomes an admin. */
export async function applyOwner(): Promise<string | null> {
  const email = ownerEmail();
  if (!email) return null;
  const [owner] = await db.update(users).set({ role: "owner" }).where(sql`lower(${users.email}) = ${email}`).returning({ id: users.id });
  if (!owner) return null;
  await db.update(users).set({ role: "admin" }).where(and(eq(users.role, "owner"), ne(users.id, owner.id)));
  return email;
}
