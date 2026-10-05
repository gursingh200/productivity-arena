/**
 * Timezone utilities — pure functions, no database dependencies.
 *
 * Uses the built-in Intl API (available in Node ≥ 13 and modern browsers)
 * rather than any external library.
 */

/**
 * Format a Date as a YYYY-MM-DD string in the given IANA timezone.
 *
 * Example:
 *   toUserDay(new Date("2024-01-15T23:00:00Z"), "America/New_York")
 *   // → "2024-01-15"  (still Monday in New York; UTC would be 2024-01-16)
 */
export function toUserDay(timestamp: Date, timezone: string): string {
  // en-CA locale uses the ISO date format (YYYY-MM-DD) which we can return directly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

/**
 * Return the UTC instant corresponding to local midnight (00:00:00) of `dateStr`
 * in `timezone`.
 *
 * Uses noon UTC as anchor rather than midnight UTC so that DST transitions
 * (which happen at 2 am local, never at noon) do not cause the iterative
 * correction to diverge.
 */
export function localMidnightToUtc(dateStr: string, timezone: string): Date {
  const parts = dateStr.split("-");
  const y = parseInt(parts[0]!);
  const m = parseInt(parts[1]!) - 1; // 0-indexed
  const d = parseInt(parts[2]!);

  // Anchor: noon UTC on the requested date (safe from DST transitions)
  const noonUtc = new Date(Date.UTC(y, m, d, 12, 0, 0));

  // What local time does noon UTC correspond to in the target timezone?
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(noonUtc);

  let lh = parseInt(fmt.find((p) => p.type === "hour")!.value);
  const lm = parseInt(fmt.find((p) => p.type === "minute")!.value);
  const ls = parseInt(fmt.find((p) => p.type === "second")!.value);

  // Normalise the rare "24" returned by some ICU implementations
  if (lh === 24) lh = 0;

  // Local midnight = noonUtc − (hours elapsed since local midnight at noon)
  // e.g. LA PDT (UTC-7): noon UTC = 05:00 local → 5 h since midnight → subtract 5 h
  const msSinceMidnight = lh * 3_600_000 + lm * 60_000 + ls * 1_000;
  return new Date(noonUtc.getTime() - msSinceMidnight);
}

/**
 * Add `days` calendar days to a YYYY-MM-DD date string (pure arithmetic).
 */
export function addDays(dateStr: string, days: number): string {
  const parts = dateStr.split("-");
  const y = parseInt(parts[0]!);
  const m = parseInt(parts[1]!) - 1;
  const d = parseInt(parts[2]!);
  const result = new Date(Date.UTC(y, m, d + days));
  return [
    String(result.getUTCFullYear()),
    String(result.getUTCMonth() + 1).padStart(2, "0"),
    String(result.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Return the week range (Monday 00:00:00 → next Monday 00:00:00) in the
 * given timezone that contains `date`.
 *
 * The returned `start` is the UTC instant corresponding to Monday midnight
 * in the user's timezone; `end` is the UTC instant corresponding to the
 * following Monday midnight (i.e. "Sunday 24:00").
 */
export function getWeekRange(
  date: Date,
  timezone: string,
): { start: Date; end: Date } {
  // Find the date string for `date` in the user's timezone
  const dayStr = toUserDay(date, timezone);
  const parts = dayStr.split("-");
  const y = parseInt(parts[0]!);
  const m = parseInt(parts[1]!) - 1;
  const d = parseInt(parts[2]!);

  // Compute day-of-week (0=Sun … 6=Sat) using a UTC Date constructed from
  // the local date string (safe for DOW arithmetic; only the weekday matters).
  const utcDate = new Date(Date.UTC(y, m, d));
  const dow = utcDate.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  const daysFromMonday = (dow + 6) % 7; // Mon→0, Tue→1, …, Sun→6

  // Compute Monday's and next Monday's date strings
  const mondayStr = addDays(dayStr, -daysFromMonday);
  const nextMondayStr = addDays(mondayStr, 7);

  return {
    start: localMidnightToUtc(mondayStr, timezone),
    end: localMidnightToUtc(nextMondayStr, timezone),
  };
}

/** UTC bounds [start, end) of a local calendar day. */
export function dayBounds(day: string, timezone: string): { start: Date; end: Date } {
  return {
    start: localMidnightToUtc(day, timezone),
    end: localMidnightToUtc(addDays(day, 1), timezone),
  };
}

/** Local hour (0–23) of an instant. */
export function localHour(date: Date, timezone: string): number {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false }).format(date),
  );
  return hour === 24 ? 0 : hour;
}
