/**
 * Which day, week and season a timestamp belongs to, and the seed everyone gets for a seeded mode.
 *
 * Shared by the client and worker/ (pure, no DOM), so both sides agree on period keys: a run
 * submitted at 23:59 must land in the same daily board the client was showing.
 *
 * Days and weeks flip at local midnight for the group that plays this game (`DAY_OFFSET_MINUTES`),
 * not at 00:00 UTC. A run at 22:00 in Brazil belongs to that evening's daily challenge, not to
 * tomorrow's — with a UTC boundary the daily would reset at 21:00 local, mid-evening.
 */
import { hashString } from "./hash";

export const DAY_MS = 86_400_000;

/** Minutes from UTC of the group's local time (Brazil, UTC-3, no DST since 2019). */
export const DAY_OFFSET_MINUTES = -180;

const OFFSET_MS = DAY_OFFSET_MINUTES * 60_000;

/** Days since the epoch in local time. The unit every period key is built from. */
export function dayIndex(ms: number): number {
  return Math.floor((ms + OFFSET_MS) / DAY_MS);
}

/** UTC timestamp at which `dayIndex` begins (local midnight). */
export function dayStart(index: number): number {
  return index * DAY_MS - OFFSET_MS;
}

/** UTC timestamp of the next local midnight after `ms` (daily reset countdown). */
export function nextDayStart(ms: number): number {
  return dayStart(dayIndex(ms) + 1);
}

/** `YYYY-MM-DD` of the local day containing `ms`. */
export function dayKey(ms: number): string {
  const d = new Date(dayIndex(ms) * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Weeks since the epoch, starting Monday. 1970-01-01 was a Thursday, so shifting by 3 days puts
 * the boundary on Monday.
 */
export function weekIndex(ms: number): number {
  return Math.floor((dayIndex(ms) + 3) / 7);
}

/** UTC timestamp at which `weekIndex` begins (Monday, local midnight). */
export function weekStart(index: number): number {
  return dayStart(index * 7 - 3);
}

/** UTC timestamp of the next Monday local midnight after `ms` (weekly reset countdown). */
export function nextWeekStart(ms: number): number {
  return weekStart(weekIndex(ms) + 1);
}

/**
 * ISO-style label for the local week, e.g. `2026-W38`. The year and number come from the Thursday
 * of that week (ISO 8601 rule), so the last days of December belong to week 1 of the next year
 * when that is where the majority of the week falls.
 */
export function weekKey(ms: number): string {
  const thursday = new Date(dayStart(weekIndex(ms) * 7 - 3 + 3));
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / (7 * DAY_MS)) + 1;
  return `${year}-W${pad(week)}`;
}

/** Days from `from` to `to`, counted in local days (used for streaks and catch-up windows). */
export function daysBetween(from: number, to: number): number {
  return dayIndex(to) - dayIndex(from);
}

/** Day index of a `YYYY-MM-DD` key — how content files pin a season or tournament to a date. */
export function dayIndexOf(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return 0;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/**
 * The seed every player gets for a seeded mode in a period. Deterministic and identical on both
 * sides; `salt` separates modes that share a period key (daily vs a tournament running that day).
 */
export function seedFor(salt: string, period: string): number {
  return hashString(`${salt}:${period}`) >>> 0;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
