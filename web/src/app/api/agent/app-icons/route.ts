import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateDevice } from "@/lib/device-auth";
import { saveIcons } from "@/lib/app-icons";

const Body = z.object({
  icons: z.array(z.object({
    bundleId: z.string().min(1).max(255),
    // Base64 PNG; the size and format are checked after decoding.
    png: z.string().min(1).max(70_000),
  }).strict()).max(20),
}).strict();

/** POST /api/agent/app-icons — the Mac app sends the icons of apps it tracked, once per app. */
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

  const saved = await saveIcons(device.userId, parsed.data.icons.map((i) => ({ bundleId: i.bundleId, png: Buffer.from(i.png, "base64") })));
  return NextResponse.json({ ok: true, saved });
}
