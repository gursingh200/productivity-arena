import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateDevice } from "@/lib/device-auth";
import { applyLinearIssues, disconnectLinear } from "@/lib/linear-sync";

const Body = z.object({
  issues: z.array(z.object({
    id: z.string().min(1).max(64),
    identifier: z.string().min(1).max(32),
    // The Mac may leave either out instead of sending null.
    estimate: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
    completedAt: z.string().datetime({ offset: true }).nullish().transform((v) => v ?? null),
  }).strict()).max(500),
}).strict();

/** POST /api/agent/linear — the Mac app reports the Linear issues assigned to its user. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const device = await authenticateDevice(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  await applyLinearIssues(device.userId, parsed.data.issues.map((i) => ({
    ...i, completedAt: i.completedAt ? new Date(i.completedAt) : null,
  })));
  return NextResponse.json({ ok: true });
}

/** DELETE /api/agent/linear — Linear was disconnected on the Mac. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const device = await authenticateDevice(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await disconnectLinear(device.userId);
  return NextResponse.json({ ok: true });
}
