# Arena handoff (2026-10-09)

Read this first when picking Arena up again. The design lives in
`docs/specs/2026-10-05-arena-design.md` (core) and
`docs/specs/2026-10-09-social-features.md` (compare, achievements, appearance,
roles, calendar). Everything below is shipped unless marked open.

## What it is

An internal leaderboard (Promethee-style) for Clueso, self-hostable by anyone.

- **Mac app** (`mac/`, Swift, SwiftPM, menu bar): tracks human active time
  (any input in a minute = 60 s; Wispr Flow/Superwhisper/MacWhisper dictation
  counts), coding-agent time from local logs (Claude Code incl. sub-agent
  threads, Codex, Cursor, OpenCode, Pi…), meetings (a call app holding the mic;
  a browser only if it also plays audio; macOS Calendar events while the Mac
  is awake and unlocked, opt-in), apps per minute. Stores everything in
  `~/Library/Application Support/Arena/arena.db`, uploads per-minute totals.
  Local dashboard "Your activity…". Self-updates from GitHub releases.
- **Web app** (`web/`, Next.js 15.5, Auth.js Google, Drizzle, Postgres):
  profiles, Your day, trends, leaderboards (incl. Total agent hours,
  Parallelism), leagues (one-step ladder), quests, XP, achievements, compare,
  guilds, settings (tabs), what's new.

## Where things run

| Thing | Where |
|---|---|
| Repo | github.com/gursingh200/productivity-arena (public, MIT). `main` = production. |
| Web | Vercel project `productivity-arena`, team scope `gms-9601`, region sin1, project id `prj_nsExuCyfAc3iBidR1ZdY1CmdyWq9` |
| Domain | https://productivity-arena.internal.clueso.io (CNAME in Route 53, Clueso Production account; old `productivity-arena-eight.vercel.app` 308-redirects) |
| Database | Neon (Vercel integration), pooled `DATABASE_URL` + `DATABASE_URL_UNPOOLED`, `DATABASE_POOLER=1` |
| Mac releases | GitHub Releases on the same repo; `latest.json`, zip and `Arena.dmg` |
| Google OAuth | Internal consent screen in Clueso's GCP (owner manages it) |

Vercel env (production + preview): `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`,
`ALLOWED_EMAIL_DOMAIN=clueso.io`, `ARENA_TIMEZONE=Asia/Kolkata`,
`PUBLIC_BASE_URL`, `ARENA_RELEASES_REPO`, `ARENA_START_DATE=2026-10-05`,
`ARENA_OWNER_EMAIL=gurmehar@clueso.io`, Neon vars. GitHub repo variables:
`ARENA_UPDATE_PUBLIC_KEY`, `ARENA_SERVER_URL`; secrets for signing (see README).

## How to ship

- Merge/push to `main`. Vercel builds with `pnpm db:migrate && pnpm build`;
  `db:migrate` = drizzle migrations, then `src/scripts/purge-before-start.ts`
  (deletes data before `ARENA_START_DATE`, applies the owner role, moves
  never-set accounts to the company timezone, evaluates everyone's
  achievements). Check the build log for those lines.
- A push that touches `mac/**` also runs "Release Mac app" (version
  `mac/VERSION` + run number, currently 0.1.17). Macs update within an hour.
- Before shipping user-visible changes, add an entry to
  `web/src/lib/changelog.ts` (What's new); set `mac` to the release version.
- Work that isn't ready goes on a branch (`social` was the last one, now
  merged). Pushing to `main` deploys.

## Local dev

```
cd web && docker compose up -d            # Postgres on 5433
set -a && . ./.env.local && set +a && pnpm dev --port 3001
```
Sign in with the Development login box: `priya@clueso.io` (rich demo data) or
`gurmehar@clueso.io` (owner, guild admin locally). `pnpm seed` wipes and
reseeds. Tests: `pnpm test` (web, 203, needs the local DB), `mac/scripts/test.sh`
(96). Lint: `pnpm lint`; types: `npx tsc --noEmit`.

Gotchas:
- `.env.local` sets `NODE_ENV=development`; run a production build with
  `NODE_ENV=production pnpm build`. A build overwrites `.next`, so restart
  the dev server after.
- postgres-js can't take a `Date` inside a raw `sql` template; use the query
  builder (`lt`, `gte`…).
- Device-token routes must be listed in `web/src/middleware.ts` PUBLIC_PATHS
  or they redirect to sign-in.
- `after()` (ingest) needs a request scope; API tests mock `next/server`'s
  `after`.
- Never read or write the production database from here without the owner's
  say-so (the permission system blocks it anyway).
- The Playwright MCP browser is shared: don't drive it while a subagent does.

## Product rules worth remembering

- Give-to-get sharing (6 categories), enforced server-side everywhere
  (`lib/sharing.ts`), owner and admins included. Skills axes are hidden
  unless every source category is visible.
- Linear keys never touch the server (Mac Keychain); the Mac reports issue
  number, estimate, completion only.
- Calendar event titles, window titles and the private-app list never leave
  the Mac.
- Minutes kept 16 days on the server; daily rollups, XP, quests, history,
  achievements forever. Minutes > 24 h old are write-once (except total agent
  time / thread counts).
- Days follow each person's Mac timezone.
- XP caps: focus 10 h/day (8–10 h at half rate), agents 24 agent-hours/day,
  orchestration 150, Linear 400. XP uses clock agent hours, not totals.
- Leagues: one step a week; fixed bars below 5 active people, percentile
  above; away days (max two whole weeks in a row).
- Roles: owner (env) > admin > member; guild admins add unassigned people to
  their own guild and see `/guild`.
- Achievements: 41 (10 secret) in `lib/achievements.ts`; progress via
  `measureAchievements`; checked after uploads (throttled to 15 min, after
  the response) and on every deploy; backfilled unlocks carry the day reached.
- Appearance (`lib/colours.ts`): every palette is validated on every
  background with the dataviz validator; keep it that way when adding any.
- User's standing preferences: commits look authored by them (no Claude
  attribution), GitHub comments end with "- Commented by Claude", tables with
  short cells, plain-language copy, don't add unrequested features, run tests
  before claiming done, note discovered issues rather than fixing them.

## Status (2026-10-09)

Deployed: web `6b5b24d`, Mac 0.1.17. The deploy made gurmehar@clueso.io the
owner and unlocked 112 achievements from past data.

Not yet verified for real (only tests / local):
- Calendar meetings on a real Mac with a Google calendar.
- Keychain handoff across a real self-update (should be no password prompt
  from 0.1.10 on).
- Sub-agent total time on real Claude logs (backfill ran from 0.1.16).
- Teams calls (bundle id known, no one tested).

## Open (not started; ask before doing)

From the layout audit (2026-10-09), unfixed:
1. Phone nav: 7 links scroll sideways with no hint ("Achievements" cut off).
2. Toggles that look like text (Per day / Running total, Hide empty days,
   scale switch) need a clearer pill style.
3. Your day: native date picker clashes; three ways to change day; empty
   chart shows a bare grid.
4. Past results (`/leaderboard/history`) unreadable on phones (two columns).
5. Empty Finished panel on Quests; near-empty Parallelism board.
6. Agent chats table on Your day needs row striping.

Earlier audit (code), unfixed: duplicated "2h ago" helper and series
definitions; inline max-widths per page; `leaguesForWeek` and
`saveFinishedPeriods` catch up inside page requests (risk after long gaps);
`changeTimezone` runs outside the ingest transaction.

Ideas discussed, not built: Raycast extension (scoped: options A Raycast-only,
B with a native helper, C front end only); Apple Developer ID ($99/yr) to
remove "Open Anyway" and Keychain prompts for good; comparing more than two
people (`/compare?with=a,b` is reserved for it); parallel sub-agents counting
toward XP (deliberately not); more social features the owner wants to add.
