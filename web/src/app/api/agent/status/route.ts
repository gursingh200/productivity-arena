import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/device-auth";
import { buildStatusPayload } from "@/lib/status";
import { syncLinearIfNeeded } from "@/lib/linear-sync";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(req.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sync Linear if needed (non-blocking — errors don't fail status)
  try {
    await syncLinearIfNeeded(auth.userId);
  } catch {
    // Ignore sync errors
  }

  const status = await buildStatusPayload(auth.userId);
  return NextResponse.json(status);
}
