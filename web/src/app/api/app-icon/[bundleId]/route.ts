import { NextRequest, NextResponse } from "next/server";
import { iconPng } from "@/lib/app-icons";

/** GET /api/app-icon/<bundle id> — an app's icon, for signed-in people (the middleware checks). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ bundleId: string }> }): Promise<NextResponse> {
  const { bundleId } = await params;
  const png = await iconPng(bundleId);
  if (!png) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
