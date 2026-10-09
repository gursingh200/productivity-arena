/**
 * Admin guild management: only admins can create guilds and move people.
 * Runs against the real Postgres; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";

const DB_URL = process.env.DATABASE_URL;
const session = { user: { id: "" } };
vi.mock("@/auth", () => ({ auth: async () => session }));

describe.skipIf(!DB_URL)("guilds", async () => {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const create = (await import("@/app/api/admin/guilds/route")).POST;
  const guildRoute = await import("@/app/api/admin/guilds/[id]/route");
  const assign = (await import("@/app/api/admin/members/[id]/guild/route")).PUT;
  const setRole = (await import("@/app/api/admin/members/[id]/role/route")).PUT;
  const setGuildAdmin = (await import("@/app/api/admin/members/[id]/guild-admin/route")).PUT;
  const addToGuild = (await import("@/app/api/guild/members/route")).POST;
  const req = (body?: unknown) => new NextRequest("http://localhost/x", {
    method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  const stamp = Date.now();
  let admin = "";
  let member = "";
  const made: string[] = [];

  beforeAll(async () => {
    const rows = await db.insert(schema.users).values([
      { email: `guild-admin-${stamp}@clueso.io`, handle: `gadmin${stamp}`, role: "admin" },
      { email: `guild-member-${stamp}@clueso.io`, handle: `gmember${stamp}` },
    ]).returning();
    admin = rows[0]!.id;
    member = rows[1]!.id;
  });
  afterAll(async () => {
    await db.delete(schema.users).where(inArray(schema.users.id, [admin, member]));
    if (made.length) await db.delete(schema.guilds).where(inArray(schema.guilds.id, made));
  });

  it("members can't create guilds or move people", async () => {
    session.user.id = member;
    expect((await create(req({ name: "Sneaky" }))).status).toBe(403);
    expect((await assign(req({ guildId: null }), params(member))).status).toBe(403);
  });

  it("only the owner makes admins; guild admins add only people without a guild", async () => {
    const extra = await db.insert(schema.users).values([
      { email: `guild-owner-${stamp}@clueso.io`, handle: `gowner${stamp}`, role: "owner" },
      { email: `guild-free-${stamp}@clueso.io`, handle: `gfree${stamp}` },
      { email: `guild-taken-${stamp}@clueso.io`, handle: `gtaken${stamp}` },
    ]).returning();
    const [owner, free, taken] = extra.map((u) => u.id) as [string, string, string];
    const [g1, g2] = await db.insert(schema.guilds).values([
      { name: "One", slug: `one-${stamp}` }, { name: "Two", slug: `two-${stamp}` },
    ]).returning();
    made.push(g1!.id, g2!.id);
    try {
      session.user.id = admin; // an admin can't make admins
      expect((await setRole(req({ role: "admin" }), params(member))).status).toBe(403);
      session.user.id = owner;
      expect((await setRole(req({ role: "admin" }), params(member))).status).toBe(200);
      expect((await setRole(req({ role: "member" }), params(owner))).status).toBe(409); // the owner stays owner
      await db.update(schema.users).set({ role: "member" }).where(eq(schema.users.id, member));

      // Admin puts the member in guild One and makes them its admin; "taken" is in guild Two.
      session.user.id = admin;
      await db.update(schema.users).set({ guildId: g1!.id }).where(eq(schema.users.id, member));
      await db.update(schema.users).set({ guildId: g2!.id }).where(eq(schema.users.id, taken));
      expect((await setGuildAdmin(req({ guildAdmin: true }), params(member))).status).toBe(200);

      session.user.id = member;
      expect((await addToGuild(req({ userId: free }))).status).toBe(200);
      expect((await db.query.users.findFirst({ where: eq(schema.users.id, free) }))?.guildId).toBe(g1!.id);
      expect((await addToGuild(req({ userId: taken }))).status).toBe(409); // can't take from another guild
      expect((await setRole(req({ role: "admin" }), params(free))).status).toBe(403);
    } finally {
      await db.delete(schema.users).where(inArray(schema.users.id, [owner, free, taken]));
      await db.update(schema.users).set({ guildId: null, guildAdmin: false }).where(eq(schema.users.id, member));
    }
  });

  it("admins create, assign, rename and delete", async () => {
    session.user.id = admin;
    const res = await create(req({ name: "Core Team" }));
    expect(res.status).toBe(200);
    const guild = (await res.json()) as { id: string; slug: string };
    made.push(guild.id);
    expect(guild.slug).toBe("core-team");

    expect((await assign(req({ guildId: guild.id }), params(member))).status).toBe(200);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, member) }))?.guildId).toBe(guild.id);

    expect((await guildRoute.PATCH(req({ name: "Core" }), params(guild.id))).status).toBe(200);
    expect((await guildRoute.DELETE(req(), params(guild.id))).status).toBe(200);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, member) }))?.guildId).toBeNull();
  });
});
