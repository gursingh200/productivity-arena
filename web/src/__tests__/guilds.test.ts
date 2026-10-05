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
