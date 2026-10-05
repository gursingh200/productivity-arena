# Deploying Arena (Vercel + Neon or Supabase)

The web app is a Next.js app in `web/`. It needs Postgres and an HTTPS address the
Mac app can reach. This guide uses Vercel for the app and either Neon or Supabase
for the database; both free tiers fit a team of about 20.

> Vercel's free Hobby plan is for non-commercial use. Fine for a trial; move the
> project to Pro ($20/month) before the whole company relies on it.

## 1. Push the repo

Vercel deploys from Git. Push this repo to a **private** GitHub repository.

## 2. Create the database

### Option A: Neon (simplest with Vercel)

1. In Vercel, open **Storage → Marketplace → Neon** and create a database, or
   create one at neon.com and connect it to the project.
2. Pick the region closest to your team, and use the same region for Vercel
   functions (Project → Settings → Functions → Region).
3. The integration sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`
   (direct). If you created it yourself, copy both from Neon's **Connect** dialog.

Free plan: 0.5 GB storage and 100 compute-hours a month per project. The database
sleeps after 5 idle minutes, and each Mac uploads every 5 minutes while it has new
data, so watch **Usage** in Neon during the first week.

### Option B: Supabase

1. Create a project at supabase.com, in the region closest to your team.
2. **Connect → Transaction pooler** URI (port 6543) → `DATABASE_URL`.
3. **Connect → Session pooler** URI (port 5432) → `DATABASE_URL_UNPOOLED`.
   Use the session pooler, not "Direct connection": on the free plan the direct
   address is IPv6-only and Vercel's build machines can't reach it.

Free plan: 500 MB storage, no compute-hour cap. A project that sees no activity
for 7 days is paused (data kept; restore it from the dashboard).

## 3. Google sign-in

1. Google Cloud Console → **APIs & Services → OAuth consent screen**: choose
   **Internal** if everyone is in your Google Workspace (only your domain can sign
   in). For personal Gmail accounts choose **External** and add each person as a
   test user; `ALLOWED_EMAILS` still decides who Arena lets in.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized redirect URI: `https://<your-app>.vercel.app/api/auth/callback/google`
   (add your custom domain too if you use one).
3. Copy the client ID and secret into the env vars below.

## 4. Create the Vercel project

1. **Add New → Project**, import the repo.
2. **Root Directory:** `web`. Framework: Next.js.
3. **Build Command:** `pnpm db:migrate && pnpm build`. This applies database
   migrations on every deploy, using `DATABASE_URL_UNPOOLED`.
4. Environment variables (Production):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Pooled connection string |
| `DATABASE_URL_UNPOOLED` | Direct / session-pooler connection string |
| `DATABASE_POOLER` | `1` |
| `AUTH_SECRET` | Output of `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | Google client ID |
| `AUTH_GOOGLE_SECRET` | Google client secret |
| `ALLOWED_EMAIL_DOMAIN` | Your Google Workspace domain, e.g. `yourcompany.com` (optional if you use `ALLOWED_EMAILS`) |
| `ALLOWED_EMAILS` | Optional comma-separated addresses, for people outside a Workspace (e.g. friends' Gmail accounts) |
| `ARENA_SECRET` | Output of `openssl rand -hex 32` (encrypts Linear keys; never change it) |
| `PUBLIC_BASE_URL` | `https://<your-app>.vercel.app` (used in Mac pairing links) |
| `ARENA_TIMEZONE` | The company's timezone for weeks, e.g. `Asia/Kolkata` |
| `ARENA_RELEASES_REPO` | Optional: `owner/repo` with Mac releases, if not the repo Vercel deploys from |

Don't set `ARENA_DEV_LOGIN` in production: it enables passwordless email login.

5. Deploy.

## Updating

Merging to `main` redeploys production and applies any new migrations. Pull
requests get preview deployments. Previews must not migrate your production
database:

- **Neon:** the Vercel integration gives each preview its own database branch,
  so this is handled for you.
- **Supabase:** in Vercel, set the Preview environment's `DATABASE_URL` and
  `DATABASE_URL_UNPOOLED` to a second (free) project, or change the Preview build
  command to plain `pnpm build`.

Deploy the server before releasing a Mac update that depends on it. The server
keeps accepting older Mac versions (new fields are always optional).

## 5. First sign-in and pairing

1. Open the site and sign in with Google. **The first person to sign in becomes
   the admin**, so do this yourself before sharing the link.
2. Choose what you share on the welcome screen.
3. Open **Connect a Mac**, create a pairing link and open it on the Mac running
   Arena. The menu bar confirms the connection.
4. Share the link with the team. Each person installs Arena.app, signs in, picks
   their sharing and pairs their Mac.

## How much it stores

Per-minute data (apps, agents, calls) is kept for 16 days; daily summaries, XP,
chats and quests are kept for good. For 20 people that's roughly 35 MB of rolling
minute data plus about 25 MB of history a year.
