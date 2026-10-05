import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/device-auth";
import { buildStatusPayload } from "@/lib/status";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(req.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await buildStatusPayload(auth.userId);
  return NextResponse.json(status);
}
