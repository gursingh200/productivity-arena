import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadUrl, installPrompt } from "@/lib/download";

afterEach(() => vi.unstubAllEnvs());

describe("Mac download link", () => {
  it("uses ARENA_RELEASES_REPO", () => {
    vi.stubEnv("ARENA_RELEASES_REPO", "acme/arena");
    expect(downloadUrl()).toBe("https://github.com/acme/arena/releases/latest/download/Arena.dmg");
  });

  it("falls back to the repo Vercel deploys from", () => {
    vi.stubEnv("ARENA_RELEASES_REPO", "");
    vi.stubEnv("VERCEL_GIT_REPO_OWNER", "acme");
    vi.stubEnv("VERCEL_GIT_REPO_SLUG", "arena-fork");
    expect(downloadUrl()).toBe("https://github.com/acme/arena-fork/releases/latest/download/Arena.dmg");
  });

  it("is absent when no repo is known", () => {
    vi.stubEnv("ARENA_RELEASES_REPO", "");
    vi.stubEnv("VERCEL_GIT_REPO_OWNER", "");
    vi.stubEnv("VERCEL_GIT_REPO_SLUG", "");
    expect(downloadUrl()).toBeNull();
  });

  it("install prompt names the app, the download and the connect page", () => {
    const prompt = installPrompt("https://example.com/Arena.dmg", "https://arena.acme.com");
    expect(prompt).toContain("Arena Mac app");
    expect(prompt).toContain("https://example.com/Arena.dmg");
    expect(prompt).toContain("https://arena.acme.com/connect");
  });
});

describe("version comparison", () => {
  it("compares numerically, not as text", async () => {
    const { isOlderVersion } = await import("@/lib/download");
    expect(isOlderVersion("0.1.9", "0.1.10")).toBe(true);
    expect(isOlderVersion("0.1.8", "0.1.8")).toBe(false);
    expect(isOlderVersion("0.2", "0.1.9")).toBe(false);
  });
});
