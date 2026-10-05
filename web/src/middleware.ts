import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/auth/signin",
  "/api/ingest",
  "/api/agent/status",
  "/api/agent/quests",
  "/api/agent/linear",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow public API routes (device bearer token auth handled inside)
  for (const pub of PUBLIC_PATHS) {
    if (pathname.startsWith(pub)) return NextResponse.next();
  }

  // Allow auth callback routes
  if (pathname.startsWith("/api/auth")) return NextResponse.next();

  // Require session for everything else
  if (!req.auth) {
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)",
  ],
};
