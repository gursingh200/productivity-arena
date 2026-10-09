import { NextRequest, NextResponse } from "next/server";
import { ACCENTS, faviconSvg } from "@/lib/colours";

/** GET /api/icon?accent=<id> — the tab icon in an accent colour (public: it's just a coloured logo). */
export function GET(req: NextRequest): NextResponse {
  const id = req.nextUrl.searchParams.get("accent") ?? "ember";
  const accent = ACCENTS.some((a) => a.id === id) ? id : "ember";
  return new NextResponse(faviconSvg(accent), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400, immutable" },
  });
}
