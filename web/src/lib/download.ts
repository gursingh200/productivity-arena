/**
 * Where the Mac app is downloaded from: the newest GitHub release of the
 * releases repo. GitHub's "latest/download" link always points at the newest
 * build, so the site never needs updating when a release ships.
 *
 * ARENA_RELEASES_REPO is "owner/repo". On Vercel it defaults to the repo the
 * project deploys from, which is right when releases live in the same repo.
 */
export function releasesRepo(): string | null {
  const explicit = process.env.ARENA_RELEASES_REPO?.trim();
  if (explicit) return explicit;
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  return owner && slug ? `${owner}/${slug}` : null;
}

/** The latest Arena.dmg, or null when no releases repo is configured. */
export function downloadUrl(): string | null {
  const repo = releasesRepo();
  return repo ? `https://github.com/${repo}/releases/latest/download/Arena.dmg` : null;
}

export function siteUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** A prompt people can paste into their coding agent to install Arena for them. */
export function installPrompt(dmg: string, site: string): string {
  return [
    "Install the Arena Mac app (a menu bar app that tracks my active time and coding agent time for our team leaderboard) on this Mac:",
    "",
    `1. Download ${dmg} to ~/Downloads/Arena.dmg (use curl -L).`,
    "2. Mount it with hdiutil attach, copy Arena.app into /Applications (replace any older Arena.app), then detach the disk image.",
    "3. Open /Applications/Arena.app.",
    "",
    "Arena isn't notarized by Apple, so the first open may be blocked. If it is, don't work around it: tell me to open System Settings → Privacy & Security and click Open Anyway, then open Arena again.",
    "",
    `When Arena's flame icon is in the menu bar, tell me to go to ${site}/connect and click Open in Arena to link it to my account.`,
  ].join("\n");
}

export interface LatestRelease {
  version: string;
  build: number;
}

/** The newest Mac release, from its latest.json; cached for 10 minutes. Null if unknown. */
export async function latestRelease(): Promise<LatestRelease | null> {
  const repo = releasesRepo();
  if (!repo) return null;
  try {
    const res = await fetch(`https://github.com/${repo}/releases/latest/download/latest.json`, { next: { revalidate: 600 } });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<LatestRelease>;
    return typeof json.version === "string" && typeof json.build === "number" ? { version: json.version, build: json.build } : null;
  } catch {
    return null;
  }
}

/** Compares dotted versions ("0.1.10" > "0.1.9"). */
export function isOlderVersion(installed: string, latest: string): boolean {
  const a = installed.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = latest.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}
