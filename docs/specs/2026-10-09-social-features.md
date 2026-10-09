# Social features (unreleased, branch `social`)

Built on the `social` branch and not deployed until approved. Everything follows
the existing give-to-get sharing rules: you see a stat of a teammate only if you
both share its category.

## 1. Skills radar, reworked

- **Velocity → Parallelism.** Velocity measured Linear issues only, which zeroed
  everyone outside engineering. Parallelism = total agent hours ÷ agent hours
  (sub-agents running side by side), 10 = 3×. Linear still earns XP.
- **Three scales**, chosen with a toggle wherever the radar appears:
  - **Team** (default): each axis is your percentile among people active in
    the last 30 days (top = 10, bottom = 0). Shows where you're strong compared
    with everyone.
  - **Guild**: the same, among your guild.
  - **Absolute**: today's fixed targets (10 = 120-min block, 8 h days, 3×…).
- An axis is computed only from categories the viewer may see (unchanged).

## 2. Compare (`/compare?with=<handle>`)

FIFA-style 1:1, built so more teammates can be added later (`with=a,b`).

| Section | Shows |
|---|---|
| Radar overlay | Both radars on one chart, scale toggle, who leads each axis |
| Head to head | This week and last 30 days: XP, level, league, human, agents, total agents, parallelism, meetings, focus blocks |
| Over time | Both people's daily hours on one chart (human or agents, toggle) |
| Record | Weeks each person won on XP since both started |
| When you work | Average activity by hour of day, last 14 days, both overlaid |
| Top apps | Each person's top apps and agents, last 30 days |
| Records | Longest streak, best week, longest focus block, most agents at once |
| Achievements | Unlocked by both / only one, with dates |

Entry points: a **Compare** button on every profile, and a person picker on
`/compare`.

## 3. Achievements (`/achievements`)

Steam-style: every achievement with its **global rate** (share of active people
who have it), sorted rarest first, your unlocks highlighted with dates, and a
per-person view on profiles and in Compare. Unlocks are saved once
(`user_achievements(user_id, achievement_id, unlocked_at)`), checked after uploads
(after the response, at most every 15 minutes per person) and once on deploy for past data. Each achievement belongs to a sharing
category; you see someone's achievement only if you both share that category.
Global rates count everyone (they reveal no one's stats).

| Achievement | Unlocks when | Category |
|---|---|---|
| First steps | first active minute | human |
| Deep diver | a 90-minute focus block | human |
| Full day | 8 h human time in one day | human |
| Early bird | active between 4:00 and 7:00 on 5 days | human |
| Night owl | active after midnight on 5 days | human |
| On a roll | 5-day streak (2 h+ a day) | human |
| Unstoppable | 20-day streak | human |
| Centurion | 100 human hours | human |
| First agent | first agent minute | agents |
| Squad | 5 agents at once (sub-agents count) | agents |
| Swarm | 10 agents at once | agents |
| Night shift | agents worked 2 h while you were away (0:00–6:00) | agents |
| Conductor | a week at 2× parallelism (5 agent hours+) | agents |
| Hundred-hour agents | 100 agent hours | agents |
| Thousand threads | 1,000 total agent hours | agents |
| Level 5 / 10 / 25 | reach that level | xp |
| Promoted | move up a league | xp |
| Legend | reach Legend | xp |
| Quester | complete 10 quests | xp |
| Live wire | complete 5 live quests | xp |
| Guild hero | your guild completes a guild quest | xp |
| Shipper | close 10 Linear issues | xp |
| Maker's day | a weekday with 4 h focus and no meetings | meetings |

## 4. Colours (Settings → Colours)

Pick an accent and a palette for human / agents / meetings from presets that
were checked for colour-blind safety; stored per person, applied only to what
you see (charts, bars, dots, buttons).

## 5. Google Calendar (Mac)

The Mac reads the macOS Calendar app (EventKit; Google accounts added in
System Settings → Internet Accounts), after a one-time Calendar permission.
Nothing Google-related is stored on the server.

- **Counts:** a minute inside a calendar event counts as meeting time while the
  Mac is awake and unlocked, even with no call app (in-person meetings). Call
  apps holding the mic still win and are credited by name.
- **Skipped:** declined, all-day, "free" and solo events.
- **Labels:** event titles stay on the Mac (Your activity shows them); the
  website shows "Calendar meeting".

## 6. Changelog (`/changelog`)

A page listing what shipped and when, in plain language, newest first; the
entries for this release are written as part of it. Linked from the account menu.
