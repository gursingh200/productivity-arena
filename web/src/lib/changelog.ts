/**
 * What changed, for people using Arena (shown on /changelog). Newest first.
 * Write for teammates, not developers: what they can now do or see.
 * When a release ships, set its `date` to the deploy day and `mac` to the
 * version the release workflow published (gh release list).
 */
export interface Release {
  date: string; // YYYY-MM-DD
  title: string;
  /** The Mac version this release needs, if any. */
  mac?: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    date: "2026-10-09",
    title: "Compare, achievements, appearance and guilds",
    mac: "0.1.17",
    changes: [
      "Compare yourself with a teammate: both skills radars scaled head to head with the real numbers, the weeks each of you won, trends, when you each work, top apps, personal bests and achievements.",
      "Achievements: 41 to unlock, ten of them secret, with how rare each one is and your progress towards it. Put yours next to a teammate’s, Steam-style. Past achievements were unlocked from your history, dated the day you reached them.",
      "The skills radar shows fixed targets, or ranks you against the team or your guild. Parallelism replaces Velocity, which only counted Linear issues.",
      "Settings has tabs, and Appearance lets you pick a background, palette, accent and bar style, with a live preview. The accent colours the logo and the tab icon; your Mac’s dashboard uses the same colours.",
      "Guild admins can see their guild’s page and add people who aren’t in a guild yet. Admins choose guild admins on the Team page.",
      "Count Calendar Meetings (Arena menu → Privacy): calendar meetings with other people count while your Mac is awake and unlocked, so in-person meetings count too. Event names stay on your Mac.",
      "The account menu opens on hover, What’s new lists every change, and the leaderboard shows sub-agent time on top of agent hours.",
    ],
  },
  {
    date: "2026-10-06",
    title: "Your day, trends and total agent hours",
    mac: "0.1.16",
    changes: [
      "Your day: hour by hour, the XP you earned and why, apps, calls and agent chats, with Today, Yesterday and a date picker.",
      "Over time on your profile: daily hours or a running total, with week lines and empty days hidden.",
      "Total agent hours count every sub-agent on its own, next to clock-time agent hours. New leaderboards: Total agent hours and Parallelism. Past weeks were filled in from your Claude logs.",
      "Your days follow your Mac’s timezone, so the website and the Mac agree on what today is.",
      "Recording in a browser no longer counts as a meeting; a call has to be playing audio too.",
    ],
  },
  {
    date: "2026-10-05",
    title: "Leagues, away days and a lot of fixes",
    mac: "0.1.12",
    changes: [
      "Leagues are a ladder: you move at most one league a week. Small leagues use fixed XP bars, big ones rank against each other.",
      "Mark days away in Settings, up to two whole weeks in a row, and your league waits for you.",
      "How XP works, Download, Report a bug and Guilds (for admins) pages.",
      "Connect to Arena… from the Mac links it in one click. Updates no longer ask for your password.",
      "Linear keys stay in your Mac’s Keychain; the Mac reports only issue numbers, estimates and completion times.",
      "Everyone counts from the same start date, and daily XP stops after 10 hours of focus and 24 agent-hours.",
    ],
  },
];
