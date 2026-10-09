# Arena — design spec

Date: 2026-10-05
Status: v1 (building)

Arena is an internal, Promethee-style "work as a multiplayer game" system. An always-on,
very lightweight native macOS agent measures **how much a human works** (real input
activity, per frontmost app) and **how much work they get coding agents to do**
(Claude Code, Codex, OpenCode, Pi, Cursor, others — including many running in
parallel). A web app turns that into XP, levels, weekly leagues, a leaderboard,
profiles and quests. Linear issues completed also earn XP.

## Goals

- Always-on measurement. No "start session" button required.
- Two headline numbers everywhere: **Human hours** and **Agent hours**.
  Agent hours add up across parallel sessions (3 agents for 1h = 3 agent-hours).
- Really lightweight agent: native Swift, event-driven, target < 30 MB RSS and
  ~0% CPU when idle. No Electron, no screenshots, no keystroke content.
- Serves both motivation (public leaderboard) and management visibility (admins see
  team rollups), while the owner controls what is public.
- Quests: live (offered in-flow), daily/weekly, and guild (team pooled).
- Linear sync → XP for completed issues.
- macOS first; core logic portable so a Windows/Linux port only rewrites sensors.

## Non-goals (v1)

- Social feed, posts, follows, congrats, session recap images.
- Admin-authored custom quests.
- Window titles leaving the machine.
- Cursor dashboard API (would require borrowing the user's Cursor auth token).

## Components

```
arena/
  mac/   SwiftPM package
         ArenaCore  — pure Foundation: bucketing, agent log parsers, interval math,
                      SQLite store, uploader, API models. Portable.
         ArenaMac   — macOS sensors behind protocols (input idle, frontmost app,
                      window title, file watching, process scan, sleep/lock).
         Arena      — menu-bar app (AppKit, LSUIElement), pairing, quest UI.
  web/   Next.js (App Router) + Drizzle + Postgres. API + UI in one deployable.
  docs/  this spec
```

## 1. Mac agent

### 1.1 Human activity

- Every 5 s (timer with tolerance, so the OS coalesces wakeups), read
  `CGEventSource.secondsSinceLastEventType(.combinedSessionState, anyInput)`.
  No Accessibility permission needed for this.
- **Active minute:** a wall-clock minute is active if any keyboard, mouse, trackpad or
  scroll input happened inside it, or a dictation app (e.g. Wispr Flow) was holding
  the microphone during it. Each tick reads the time of the last input
  (`now − idle`) and marks that minute. Nothing is marked while paused, locked or
  asleep. **Human time = 60 s per active minute.**
- The minute's 60 s are split across the **frontmost apps** seen on its ticks
  (bundle id + name, tracked via `NSWorkspace.didActivateApplicationNotification`),
  scaled to sum to exactly 60. An active minute with no app sample is sent as
  `unknown` ("Other"); minutes without input send no apps.
- **Meetings:** each tick also lists processes capturing audio input (CoreAudio
  process objects, `kAudioProcessPropertyIsRunningInput`; no microphone permission
  needed). If a call app holds the mic (Zoom, Slack, Teams, FaceTime, Discord, Webex,
  Around, Tuple, Granola, or a browser that is also playing audio, per
  `kAudioProcessPropertyIsRunningOutput`: a call plays the other people, a recorder
  doesn't), the tick's seconds go to that app as meeting
  time, at most 60 s a minute. Meeting time is reported separately and never makes a
  minute human-active (only dictation does).
- **A call wins the minute:** each minute counts once. Human time excludes call
  time in the same minute (`human = min(human, 60 − call)`), so Human + Meetings add up
  to real time. Applied on the server across all devices; the menu bar does the same.
- **Focus time = human + call time.** It's what XP, focus blocks, focus quests,
  orchestration, skills and league eligibility use. Displays (profile, chart, team
  table, Human hours tab) show Human and Meetings separately.
- Pause on `willSleep`, `screensDidSleep`, `sessionDidResignActive`, screen lock
  (`com.apple.screenIsLocked` distributed notification); resume on the inverse.
- User controls (menu bar): Pause tracking (30 min / 1 h / until resumed),
  mark an app **private** (reported as `private` with no name).

### 1.2 Window titles (opt-in, local only)

- Off by default. When enabled (requires Accessibility), the focused window title of
  the frontmost app is sampled on each active tick and stored **only** in the local
  DB (7-day retention) for the user's own "Today" view. Never uploaded in v1.

### 1.3 Coding-agent activity

Each agent has an **adapter** that turns its local logs into *pulses* and/or explicit
*intervals*. A pulse is `(timestamp, agent, sessionId, kind: human|agent, tokensIn,
tokensOut)`. `human` = a prompt typed by a person; `agent` = anything the agent
produced (assistant message, tool call, tool result, token_count, etc).

**Interval rule (pulses → working time), per session:** sort pulses; for each
consecutive pair (a, b), the agent was working during [a, b] iff `b.kind == agent`
and `b - a ≤ 10 min`. A gap ending in a human prompt is the agent *waiting on the
human* and is not counted. Every isolated agent pulse contributes a minimum 5 s.
Adapters that know exact durations emit intervals directly.

**Token evidence rule:** pulses carry token usage where the log has it. A *turn* is
the span from one human pulse to the next in the same session. A turn's intervals only
count as working time if the turn spent **output tokens > 0** (the model actually
ran). This filters log churn with no model work (resumes, title/metadata updates,
`/clear`, compaction bookkeeping) while still counting long tool runs inside a real
turn. Agents whose logs carry no tokens (process-scan fallback) are exempt.
Tokens are counted once per model message (dedupe streaming lines by message id).
Token fields: `tokensIn` (uncached input + cache writes), `tokensCached` (cache
reads), `tokensOut` (output incl. reasoning).

**Per-chat rollups:** each session (chat) is tracked as a chat record:
`(agent, chatId = first 16 hex of sha256(agent + ":" + sessionId), firstAt, lastAt,
agentSec, turns, tokensIn, tokensCached, tokensOut)`. No titles, prompts or paths.

Working intervals are split across minute buckets. Agent seconds in a bucket are
**summed across sessions** (can exceed 60). `peak` = max concurrent sessions.

| Agent id | Source | Notes |
|---|---|---|
| `claude` | `~/.claude/projects/**/*.jsonl` (+ `$CLAUDE_CONFIG_DIR`, `~/.config/claude/projects`) | `type:user` with string/text content (not `tool_result`) = human; `assistant`/tool lines = agent; `message.usage` tokens. `<session>/subagents/*.jsonl` belong to the parent session: one timeline, one parallel session, one chat (sub-agent prompts are agent events). |
| `codex` | `~/.codex/sessions/**/rollout-*.jsonl` (+ `$CODEX_HOME`) | `response_item` role `user` (not developer/system, not env context) = human; others = agent; tokens from `event_msg/token_count.info.last_token_usage`. |
| `opencode` | `~/.local/share/opencode/opencode.db` (SQLite, read-only) | assistant `message.data.time.created→completed` = exact intervals; `tokens.input/output`. Query only rows with `time_updated > watermark`. |
| `pi` | `~/.pi/agent/sessions/**/*.jsonl` (+ `$PI_CODING_AGENT_DIR`) | `type:message` role user = human, assistant = agent; `usage.input/output`. |
| `cursor` | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` `cursorDiskKV` `bubbleId:*`; `~/.cursor/chats/*/*/store.db` | bubble `type` 1 = human, 2 = agent; `createdAt`; `tokenCount`. Rescan at most every 10 min, only when mtime changed. |
| `gemini`, `amp`, `droid`, `aider`, `other` | Process scan fallback | Every 60 s list processes by name; a known agent process using > 1 s CPU in the last minute counts as 60 working seconds for that minute. |
| T3 Code | — | Drives Codex/Claude underneath; counted via their logs. |

**Incremental reading:** JSONL adapters keep a per-file cursor `(path, inode, size,
offset)` in the local DB and only parse appended bytes. Files are discovered via
FSEvents on the root dirs (latency 5 s). On first run, backfill the last 7 days of
agent logs (human activity can't be backfilled).

### 1.4 Local store

SQLite at `~/Library/Application Support/Arena/arena.db` (0600):

- `active_minute(t)` — minutes with input or dictation
- `minute_app(t, bundle_id, app_name, active_sec)` — per-minute app shares
- `meeting_minute(t, bundle_id, app_name, sec)`
- `deleted_chat(chat_id)` — chats to remove on the server (merged sub-agent sessions)
- `minute_agent(t, agent, sessions, agent_sec, peak, tokens_in, tokens_cached, tokens_out)`
- `chat(agent, chat_id, first_at, last_at, agent_sec, turns, tokens_in, tokens_cached, tokens_out, dirty)`
- `minute_title(t, bundle_id, title, sec)` — only if titles enabled; 7-day retention
- `file_cursor(path, inode, offset, size)`, `kv(key, value)` (watermarks, settings)
- `dirty_minute(t)` — buckets changed since last successful upload
- Raw minute data retention: 30 days.

### 1.5 Upload

Every 5 min (and on quit / wake), send all dirty minutes (max 1440 per request,
oldest first) to `POST /api/ingest`. On 2xx, clear those dirty marks. On failure,
exponential backoff up to 30 min. The response carries the status payload (§3.2), so
the menu bar refreshes without an extra request.

### 1.6 Menu bar UI

- Icon + today's `Human 4h 12m · Agents 9h 40m`.
- Dropdown: level + XP bar, weekly rank/league, active quests with progress, any
  **offered live quest** with Accept / Decline, today's top apps, live agent count,
  Pause, Settings (server, private apps, window titles toggle), Open dashboard.
- A new live quest posts a user notification with Accept action.

### 1.7 Pairing

Web `/connect` creates a device token and shows a button to
`arena://pair?server=<base-url>&token=<token>` (URL scheme registered by the app)
plus the same link for manual paste. Token stored in the Keychain.

## 2. Server data model (Postgres)

- `users(id, email, name, image, handle, bio, role: member|admin, guild_id, timezone, share_xp, share_human, share_agents, share_meetings, share_apps, share_skills (all default false), onboarded_at, created_at)`
- `guilds(id, name, slug, color)`
- `devices(id, user_id, name, token_hash, last_seen_at, agent_version, created_at, revoked_at)`
- `minute_app(user_id, device_id, t, bundle_id, app_name, active_sec)` — PK(device_id, t, bundle_id)
- `minute_agent(user_id, device_id, t, agent, sessions, agent_sec, peak, tokens_in, tokens_cached, tokens_out)` — PK(device_id, t, agent)
- `minute_meeting(user_id, device_id, t, bundle_id, app_name, sec)` — PK(device_id, t, bundle_id)
- `chats(user_id, device_id, agent, chat_id, first_at, last_at, agent_sec, turns, tokens_in, tokens_cached, tokens_out)` — PK(device_id, agent, chat_id)
- `daily_rollup(user_id, day, human_sec, agent_sec, meeting_sec, agent_sec_by_agent jsonb, tokens, peak_parallel, longest_focus_sec, focus_blocks, top_apps jsonb)` — recomputed from minutes for touched days. `day` uses the user's timezone.
- `xp_ledger(id, user_id, day, source: focus|agent|orchestration|linear|quest, source_key, xp, reason, rules_version, created_at)` — UNIQUE(user_id, source, source_key)
- `quests(id, user_id null, guild_id null, kind: live|daily|weekly|guild, template, title, target, unit, xp, window_start, window_end, state: offered|active|completed|failed|expired|declined, progress, created_at, resolved_at)`
- `linear_accounts(user_id, last_synced_at)` (a row means Linear is connected on the Mac)
- `linear_issues(user_id, issue_id, identifier, estimate, completed_at)`

### Retention

Minute tables (`minute_app`, `minute_agent`, `minute_meeting`) are kept for 16 days
and pruned per person on each ingest; ingest ignores minutes older than 14 days, so
no day it can recompute has lost minutes. `daily_rollup` (including `top_apps` and
`meeting_apps`), `xp_ledger`, `chats`, `quests` and Linear data are kept for good.
Roughly 175 KB per person-day of minutes versus ~1 KB of rollup.

### Ingest semantics

Replace per `(device_id, t)` for minutes from the last 24 hours: delete existing rows
for each minute in the payload for that device, insert the new ones. Older minutes
(up to 14 days) are **write-once**: accepted only if the device never sent data for
that minute, so past data can't be rewritten. A device can only ever write its own
user's data. Then recompute `daily_rollup` + derived XP for
touched days, evaluate quests, return status. Idempotent; safe to resend.

**Total agent time.** Agent hours are clock time: a chat and its sub-agents count
once. Claude sub-agent log files are also their own *threads* (`agent_event.thread`);
each thread is timed alone and the results are added up (never below clock time) and
sent per minute as `workSec`, with `threads` = threads working that minute. The server
keeps `minute_agent.work_sec/threads` and `daily_rollup.agent_work_sec/peak_threads`
(older data: total = clock). XP still follows clock time. Backfill: on first launch, 0.1.16 re-reads the Claude
sub-agent logs still on disk, tags their stored events with threads, recomputes those
chats and re-sends their minutes; the server lets locked minutes (> 24 h) change only
`work_sec` and `threads`, refreshing just the day's `agent_work_sec`/`peak_threads`,
so clock time and XP stay as they were. Leaderboard tabs: **Total
agent hours** and **Parallelism** (week's total ÷ clock agent hours, shown as 1.8×,
only for people with at least 5 agent hours that week).

**Timezones.** A person's days follow their Mac's timezone, sent as `device.timezone`
with each upload, so the website and the Mac's dashboard count the same day. A change
deletes and rebuilds that person's rollups and derived XP for the last 14 days (the
days whose minutes are still kept). Accounts no Mac has set (`users.timezone_set_at`
is null) are moved to `ARENA_TIMEZONE` on each deploy.

**Start date.** With `ARENA_START_DATE` (deployment env, `YYYY-MM-DD` in the company
timezone), minutes and chats before that day are ignored at ingest, no XP is
written for earlier days, and `pnpm db:migrate` deletes older minutes, chats,
rollups, XP, quests and saved leaderboards on every deploy. Macs backfill agent
logs, so without it people's history would depend on how long their agents kept logs.

**Pairing from the Mac.** "Connect to Arena…" opens `<site>/connect/mac?state=<32 hex>&name=<Mac>`
(the site comes from the build's `ARENA_SERVER_URL`, else the current server, else
the person types it). After sign-in, one click creates a device token and sends the
browser to `arena://pair?server=…&token=…&state=…`. The Mac accepts a link with a
`state` only if it matches the one it just sent; pasted links without `state` work
as before.

**Pairing again.** After pairing, the Mac resends its last 24 hours, so a new
server (or a new pairing with the same one) gets the whole day. Each upload carries
the Mac's stable id (`devices.client_id`). On ingest, an earlier pairing of the same
Mac for the same user (same client id, or for older pairings without one, the same
Mac name) hands its minutes and chats to the current pairing and is revoked; rows
the current pairing already has win. The resend then replaces rather than adds,
and handed-over minutes older than 24 hours stay locked.

## 3. API

### 3.1 `POST /api/ingest` (Bearer device token)

```json
{
  "schema": 1,
  "device": { "id": "uuid", "name": "Ana's MacBook Pro", "os": "macOS 26.0", "agentVersion": "0.1.0" },
  "minutes": [
    {
      "t": "2026-10-05T10:31:00Z",
      "apps":   [ { "id": "com.apple.Safari", "name": "Safari", "sec": 42 }, { "id": "private", "name": null, "sec": 18 } ],
      "agents": [ { "agent": "claude", "sec": 120, "sessions": 2, "peak": 2, "tokensIn": 1234, "tokensCached": 25838, "tokensOut": 56 } ],
      "meetings": [ { "id": "us.zoom.xos", "name": "zoom.us", "sec": 60 } ]
    }
  ],
  "deletedChats": [ "1a2b3c4d5e6f7a8b" ],
  "chats": [
    { "agent": "claude", "chatId": "9f2c4e1a7b3d5f60", "firstAt": "2026-10-05T09:02:11Z", "lastAt": "2026-10-05T10:31:40Z", "agentSec": 3120, "turns": 14, "tokensIn": 81234, "tokensCached": 2310000, "tokensOut": 40211 }
  ]
}
```

Human active seconds for a minute = sum of `apps[].sec` (≤ 60; 60 for an active
minute, 0 otherwise). `meetings` (optional) are seconds a call app held the mic; the
server keeps at most 60 s per minute. `chats` holds dirty chat records (optional,
max 2000); the server upserts them by `(device_id, agent, chatId)` with replace
semantics. `deletedChats` (optional, max 2000) removes this device's chats with
those ids. Response:
`{ "accepted": <n>, "status": <StatusPayload> }`. 401 bad token, 400 invalid payload,
413 > 1440 minutes.

### 3.2 `GET /api/agent/status` (Bearer) → StatusPayload

```json
{
  "user": { "name": "…", "handle": "…", "level": 21, "xp": 480, "xpForNext": 2100, "league": "silver", "weeklyRank": 9, "weeklyOf": 34 },
  "today": { "humanSec": 15120, "agentSec": 34800, "meetingSec": 3600, "xp": 420 },
  "quests": [ { "id": "…", "kind": "live", "title": "Stay 15 minutes longer", "xp": 200, "progress": 0, "target": 900, "unit": "sec", "state": "offered", "expiresAt": "…" } ],
  "dashboardUrl": "https://…/u/handle"
}
```

### 3.3 `POST /api/agent/quests/:id/accept` · `POST /api/agent/quests/:id/decline` (Bearer)

Also callable from the web session for the owner.

## 4. XP rules (rules_version 1)

Every ledger row carries a plain-language `reason`, e.g. `"52 active minutes, 1 focus block"`
(the XP amount is shown beside it, not repeated).
Derived rows (focus/agent/orchestration) are recomputed per day idempotently.

| Source | Rule | Cap |
|---|---|---|
| Focus | 1 XP per active minute: any human or call time in it (focus time, §1.1) | 8–10 h/day earn 0.5 XP; nothing past 10 h (max 540 XP/day) |
| Focus block bonus | +15 XP per block of ≥ 25 contiguous active minutes (gaps ≤ 2 min) | — |
| Agent | 0.25 XP per agent-minute (summed over parallel sessions) | 24 agent-hours/day (360 XP/day) |
| Orchestration | +0.5 XP per minute where ≥ 2 agents ran **and** the human was active within ±5 min | 150 XP/day |
| Linear | 20 + 15 × estimate (missing estimate = 1) per completed issue assigned to you | 400 XP/day; reopened → reversal row |
| Quests | quest's `xp` on completion | — |

The `/xp` page lists these rules, quests, levels and leagues from the same constants.

Levels: XP needed to go from level n to n+1 = `100 + 20n`. Level and progress are
derived from total XP.

**Weekly score / leaderboard:** sum of XP earned Mon 00:00 → Sun 24:00 in the user's
timezone. Leaderboard tabs: Weekly XP (default), Human hours, Agent hours, All-time level.
Ties share rank.

**History:** every finished week (per league and overall) and month (overall) saves
its top 10 for XP, Human hours and Agent hours to `leaderboard_history`, plus team
totals to `period_totals` (each total summed over the people sharing that category
who had any of it). Saved lazily when the Past results page loads; built from
rollups and the XP ledger, which are permanent. Only people sharing a category when
the period is saved are included; readers need to share it, and people who later
stop sharing drop out of their past boards.

**Leagues:** a ladder (Bronze → Silver → Gold → Diamond → Legend). Everyone starts in
Bronze; after each week people move at most one league (`nextLeagues` in leagues.ts).
Under 1 h of focus time moves you down. A league with fewer than 5 active people uses
fixed weekly XP bars (up: Bronze 1,000, Silver 1,750, Gold 2,500, Diamond 3,250; down
below: Silver 500, Gold 1,000, Diamond 1,750, Legend 2,500). A bigger league ranks its
people: up = top 30/25/20/15% (Gold needs 1,500 XP, Diamond 2,500), down = bottom
15/20/25/30%, and Legend also drops anyone under 3,000 XP. Each week's leagues are saved
to `league_weeks` the first time they're needed after the previous week ends.

**Away:** people mark weekdays away in Settings (`away_days`): next week any time, this
week only on Monday, at most two whole weeks in a row. A whole week away freezes their
league and leaves them out of the ranking; some days away scale every bar by available
weekdays, and big leagues rank by XP per available day. Teammates see "Away" that day.

## 5. Quests

Server-authoritative; evaluated on every ingest from minute data.

**Live** (at most one offered at a time; offer expires after 10 min if not accepted):

| Template | Offer trigger | Goal after accept | XP |
|---|---|---|---|
| `stay_longer` | current focus block ≥ 45 min | 15 more active minutes within 25 min | 200 |
| `parallel_push` | ≥ 1 agent running and human active | ≥ 3 concurrent agents for 10 min within 60 min | 150 |
| `deep_block` | human active ≥ 10 min with no block yet today | a 50-min focus block within 90 min | 250 |

**Daily** (3 per user per day, chosen deterministically from a seed of user+day):
`focus_4h` (4 h human, 100 XP), `agents_6h` (6 agent-hours, 100), `two_blocks`
(2 focus blocks, 80), `linear_2` (close 2 Linear issues, 120 — only if Linear linked),
`early_start` (20 active min before 10:00, 60), `parallel_3` (3 concurrent agents
for 15 min, 100).

**Weekly** (3 per user per week): `focus_20h` (300), `agents_40h` (300),
`streak_5` (active ≥ 2 h on 5 days, 250), `linear_8` (8 issues, 300).

**Guild** (1 per guild per week, pooled): e.g. "Guild: 300 agent-hours" or
"Guild: 40 Linear issues". On completion every member with ≥ 1 h that week gets the XP.
Admins create, rename and delete guilds and put people in them from the Team page
(`/api/admin/guilds`, `/api/admin/members/:id/guild`); one guild per person at most.

## 6. Skills radar (last 30 days, 0–10)

Three scales (toggle): **Team** (default) = percentile among everyone active in the last
30 days, **Guild** = percentile within your guild, **Absolute** = the targets below.
Computed for everyone at once (`skills-db.ts`), cached per request.

| Skill | Measure | 10 = |
|---|---|---|
| Willpower | median longest daily focus block | 120 min |
| Consistency | days with ≥ 2 h human / weekdays | 100% |
| Endurance | avg human hours on active days | 8 h |
| Orchestration | agent-hours ÷ human-hours | 3.0 |
| Intensity | output tokens per agent-hour | 200K |
| Parallelism | total agent hours ÷ agent hours (sub-agents side by side) | 3× |
| Competitive | quests completed ÷ quests offered | 100% |
| Camaraderie | guild quest contribution share × guild size | equal share |

## 7. Web app

- Auth: Google (Auth.js) restricted to `ALLOWED_EMAIL_DOMAIN`; a dev-only email login
  when `NODE_ENV=development`. First user becomes admin.
- Pages: `/` (your dashboard = your own profile), `/leaderboard`, `/u/[handle]`,
  `/quests`, `/connect` (pair Mac), `/settings` (profile, sharing, Linear status),
  `/welcome` (first-login sharing), `/admin` (team table: human, agent and meeting hours per person per week).
- Profile: identity with level ring and league; **this week** scoreboard (Human,
  Agents, Meetings, each against the same days last week, plus the agent-to-human
  ratio); 30-day daily chart of all three; quests; 90-day focus heatmap; apps and
  call apps (30 d); skills radar with each axis explained; agents table (agent-hours,
  output tokens, chats, most at once, output per chat, longest chat); recent XP.
- Leaderboard rows show a human/agent split bar on one shared scale.
- **Sharing (give to get):** six categories, each a per-person toggle: XP (XP, level,
  league, rank, quests, XP history), Human, Agents (incl. tokens, chats), Meetings,
  Apps (call apps also need Meetings) and Skills. Viewer V sees category C of person P
  only if P shares C **and** V shares C; you always see your own. No exceptions, admins
  included (the team page shows "–" for cells either side doesn't share). Nothing is
  shared by default. Boards are locked for categories you don't share and list only
  people who share that category; ranks are among those people. XP-history rows are
  filtered by the category they reveal (focus XP → Human, agent and orchestration XP →
  Agents, quests by what they measure). Enforced in one place (`lib/sharing.ts`) on the
  server: hidden categories are never queried into a page, a client component's props
  or an API response. Name, avatar, handle, guild and bio are always visible. Window
  titles never reach the server.
- **Onboarding:** the first sign-in goes to `/welcome` to choose sharing before
  anything else; changeable later in Settings.
- Visual: graphite dark UI set in Nohemi; fixed data colours human `#e4692c`,
  agents `#5285e6`, meetings `#35a586` (CVD-validated on the panel colour); numbers
  use text colours, with a coloured dot for identity.
- Meeting time is shown separately and isn't a leaderboard tab, but counts as focus
  time for XP and quests (see §1.1).

## 8. Linear

The server never holds a Linear key. The user pastes a personal API key in the Mac
app (Connection → Connect Linear); it's kept in the Keychain. Every 15 minutes the
Mac asks Linear for `viewer { assignedIssues(filter: { updatedAt: { gte: since } }) }`
(90 days back the first time, then from a day before the last sync) and POSTs
`/api/agent/linear` with only `{id, identifier, estimate, completedAt}` per issue
(`completedAt` only while the state is completed). The server upserts issues,
ignores future completions, and recomputes Linear XP for each day that changed;
issue no longer completed → reversal. `DELETE /api/agent/linear` disconnects (XP
earned stays). Trade-off: the server can't verify issues against Linear, the same
trust as the Mac's activity data.

## 9. Testing

- Swift: unit tests per adapter against fixture logs (incl. parallel sessions,
  human-wait gaps, partial trailing lines, file truncation), interval→bucket math,
  store round-trip, upload payload encoding.
- Web: vitest for ingest replace semantics, rollups, XP rules and caps, levels,
  leagues, quest evaluation; API route tests against a real Postgres (docker).
- End-to-end smoke: run the agent's upload against the local server, see the
  dashboard update.

## 10. Porting

`ArenaCore` uses only Foundation + SQLite. A port implements `IdleSensor`,
`FrontAppSensor`, `WindowTitleSensor`, `FileWatcher`, `ProcessScanner`, `PowerEvents`
and a tray UI. Adapter paths take platform roots from a `Paths` provider.
