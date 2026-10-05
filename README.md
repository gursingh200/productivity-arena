# Arena

A leaderboard for how much you work, and how much your coding agents work for you.

- **Human time** comes from real keyboard, mouse and dictation activity on your Mac.
- **Agent time** comes from the local logs of Claude Code, Codex, OpenCode, Pi and Cursor. Parallel sessions add up.
- **Meetings** are counted while a call app (Zoom, Meet, Slack, Discord…) holds the microphone.

Everything feeds a web app with profiles, weekly leaderboards, leagues, quests and XP. A Mac menu bar app does the tracking and has a private dashboard of your own usage.

## Arena is self-hosted: every group runs its own

There is no central Arena service. Whoever sets it up (a company, a team, a group of friends) runs a private copy:

- your own web app and database, so your data only ever goes to your server;
- your own Mac app builds and update feed;
- your own rules for who can join.

Copies never talk to each other. If you were given this repository, don't point your Mac at someone else's server; set up your own with the steps below.

## What you'll set up

| Piece | Where | Cost |
|---|---|---|
| Source code | A GitHub repo (your copy of this one), public or private | Free |
| Web app | Vercel, deployed from that repo | Free to try (Hobby is non-commercial; Pro $20/month) |
| Database | Neon or Supabase Postgres | Free tier is enough for ~20 people |
| Mac updates | GitHub Releases in a **public** repo: your copy if it's public, or a separate releases-only repo | Free |
| Sign-in | A Google OAuth client | Free |

Releases must be public so Macs can download updates without a password. The code and the built app contain no keys or data (only your web app's address, if you set `ARENA_SERVER_URL`), so publishing them is safe. Nobody can use them to reach your server: sign-in is limited to your people, and the Mac app can only upload with a device token that one of your signed-in members created. Your keys live only in your repo's GitHub secrets.

## Setup

### 1. Copy the code

Create a repo on your GitHub account or org and push this code to it (or use GitHub's **Import repository**). Public is simplest: releases go in the same repo, and GitHub Actions minutes are free. If you keep it private, also create an empty **public** releases-only repo.

### 2. Deploy the web app

Follow [`web/DEPLOY.md`](web/DEPLOY.md): database, Google sign-in, Vercel. Decide who can sign in:

| Your group | Set |
|---|---|
| A company on Google Workspace | `ALLOWED_EMAIL_DOMAIN=yourcompany.com`. Any verified account of that Workspace can join. Set the OAuth consent screen to **Internal**. |
| Friends with personal Gmail accounts | `ALLOWED_EMAILS=ana@gmail.com,bo@gmail.com`. Only those addresses can join. Set the consent screen to **External** and add them as test users. |
| Both | Set both. |

With neither set, nobody can sign in. The first person to sign in becomes the admin, so sign in yourself first.

### 3. Set up Mac releases and auto-updates

Every merge to `main` that changes `mac/` builds a signed release. Every installed Arena checks the latest release hourly and updates itself.

1. On a Mac with this repo checked out, create the two signing keys once:
   ```sh
   cd mac
   mkdir -m 700 -p ~/.arena
   swift run -c release arena-sign keygen ~/.arena/update-signing.key   # prints the update public key
   scripts/make-ci-signing-cert.sh                           # code-signing certificate for releases
   ```
   - The **update key** proves an update came from you. Each app checks it before installing anything, so even someone with write access to the releases repo can't push code to your Macs.
   - The **code-signing certificate** keeps every release signed by the same identity, so updates install cleanly and macOS doesn't ask for Keychain access again.
   - Keep both files private and backed up. If you lose them, everyone has to reinstall.
2. In your repo, open **Settings → Secrets and variables → Actions**:

   | Kind | Name | Value |
   |---|---|---|
   | Variable | `ARENA_UPDATE_PUBLIC_KEY` | The public key printed by `arena-sign keygen` |
   | Variable | `ARENA_BUNDLE_ID` | Optional, e.g. `com.yourname.arena` |
   | Variable | `ARENA_SERVER_URL` | Optional: your web app's address. **Connect to Arena…** then opens it directly; without it, people type the address once. |
   | Secret | `ARENA_UPDATE_SIGNING_KEY` | Contents of `~/.arena/update-signing.key` |
   | Secret | `MAC_SIGNING_P12` | `base64 -i ~/.arena/release-signing.p12` |
   | Secret | `MAC_SIGNING_PASSWORD` | Contents of `~/.arena/release-signing.password` |

   With a private source repo, also set the variable `ARENA_UPDATE_REPO` to your public releases repo (e.g. `yourname/arena-releases`), and the secret `RELEASES_TOKEN` to a fine-grained token with **Contents: read and write** on that repo only.

3. Run **Actions → Release Mac app → Run workflow** once to publish the first build.

### 4. Invite people

1. Send them your web app's address. Its **Download** page links to the newest Arena.dmg and has a prompt they can paste into their coding agent to install it.
2. They open **Arena.dmg** and drag **Arena** into Applications.
3. The first open is blocked because the app isn't notarized by Apple. They go to **System Settings → Privacy & Security** and click **Open Anyway**. This happens only once; updates install without it. An Apple Developer ID ($99/year) removes this step.
4. They sign in on the web app and choose what to share. Then, in Arena's menu bar, **Connect to Arena…** opens the site; one click on **Connect this Mac** links it. (Or **Connect a Mac** on the site, then **Open in Arena**.)

## What Arena collects

- **Never:** which keys you press, what you type, screenshots, prompts or chat contents, file paths. For human time it only asks macOS "how long since the last input?"
- **Kept on your Mac only:** apps per minute, agent session timing, window titles if you turn them on (off by default, kept 7 days). See it all in **Your Activity…** in the menu bar. Delete it any time under **Privacy**.
- **Sent to your server:** per-minute totals (seconds per app, agent seconds and tokens, call seconds) and per-chat totals under a one-way hashed ID. If you connect Linear, each assigned issue's number (e.g. ENG-123), estimate and completion time. Your Linear API key stays in your Mac's Keychain; the Mac asks Linear itself.
- **Shared with teammates:** only what you choose, category by category. You see a stat of someone else only if you share that stat too. Admins get no exception.

## Configuration

Web app (environment variables; see [`web/.env.example`](web/.env.example)):

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DATABASE_POOLER` | Postgres connection; see DEPLOY.md |
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Sign-in |
| `ALLOWED_EMAIL_DOMAIN`, `ALLOWED_EMAILS` | Who can join |
| `PUBLIC_BASE_URL` | Your web app's address, used in Mac pairing links |
| `ARENA_TIMEZONE` | The timezone leaderboard weeks follow |
| `ARENA_RELEASES_REPO` | `owner/repo` with your Mac releases, for the site's download link. On Vercel it defaults to the repo it deploys from. |

Mac app (set when building; CI takes them from the variables above):

| Variable | Purpose |
|---|---|
| `ARENA_UPDATE_REPO`, `ARENA_UPDATE_PUBLIC_KEY` | Where updates come from and the key they must be signed with. Unset means no auto-updates (local builds). |
| `ARENA_BUNDLE_ID` | The app's identifier |
| `ARENA_SERVER_URL` | The web app **Connect to Arena…** opens |
| `ARENA_VERSION`, `ARENA_BUILD` | Set by CI from `mac/VERSION` and the run number |

## Developing locally

```sh
# Web
cd web
docker compose up -d                       # Postgres on port 5433
cp .env.example .env.local                 # then fill in values
set -a; . ./.env.local; set +a
pnpm install && pnpm db:migrate
pnpm seed                                  # optional demo data; wipes the local database
pnpm dev --port 3001

# Mac
cd mac
scripts/setup-signing.sh                   # once: stable local signing, so Keychain stops asking after rebuilds
scripts/test.sh
scripts/build-app.sh && open dist/Arena.app
```

Pull requests run the web tests (with Postgres), type check, lint and build, plus the Mac tests when `mac/` changes. The design is in [`docs/specs`](docs/specs).
