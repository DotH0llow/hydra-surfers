/**
 * Proportional anti-cheat: what a submitted run must look like to be accepted onto a board.
 *
 * This is not an arms race. It is for a private group, so it only rejects the obviously impossible
 * (a daily score submitted with someone else's seed, 40 km in two minutes, a score no multiplier
 * stack could reach) and makes every board cheap to trust. Shared with worker/ so the client can
 * run the same checks before submitting and never be surprised by a rejection.
 */
import { dayKey, seedFor, weekKey } from "./calendar";
import { TOURNAMENTS, activeTournament } from "./content/season";

export const LIMITS = {
  nameMin: 3,
  nameMax: 16,
  playerIdMax: 64,
  /** Fastest any mutator stack can make the road (m/s), with headroom. */
  maxSpeed: 60,
  /** Longest run the server believes (seconds). */
  maxDuration: 3 * 3600,
  /**
   * Points per metre no combination of multipliers can exceed (guild x30, blessing x2, combo x1.8,
   * mutators x3 and skill awards on top), with generous headroom.
   */
  maxScorePerMetre: 700,
  /** Coins per metre with the densest coin mutator and the richest region. */
  maxCoinsPerMetre: 2.5,
  /** A run submitted this long after its period rolled over still counts for it. */
  lateGraceMs: 6 * 3_600_000,
} as const;

export interface RunClaim {
  board: string;
  period: string;
  seed: number;
  score: number;
  distance: number;
  coins: number;
  /** Seconds of run time. */
  duration: number;
}

const NAME_RE = /^[\p{L}\p{N} _.-]+$/u;

/** A display name everyone else will see: 3-16 letters, digits, spaces or _ . - */
export function validName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) return null;
  return NAME_RE.test(name) ? name : null;
}

/** Case- and accent-insensitive key, so "Ana" and "ANA" cannot both exist. */
export function nameKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The seed a seeded board must be played on, or null for boards that take any seed. */
export function expectedSeed(board: string, period: string): number | null {
  if (board === "daily") return seedFor("daily", period);
  if (board === "weekly") return seedFor("weekly", period);
  if (board.startsWith("event:")) return seedFor("event", board.slice(6));
  return null;
}

/** Whether `period` is (still) the live period of `board` at `now`. */
export function periodIsLive(board: string, period: string, now: number): boolean {
  const earlier = now - LIMITS.lateGraceMs;
  if (board === "season") return period === "";
  if (board === "daily") return period === dayKey(now) || period === dayKey(earlier);
  if (board === "weekly") return period === weekKey(now) || period === weekKey(earlier);
  if (board.startsWith("event:")) {
    const id = board.slice(6);
    if (period !== id || !TOURNAMENTS.some((t) => t.id === id)) return false;
    return activeTournament(now)?.id === id || activeTournament(earlier)?.id === id;
  }
  return false;
}

/** Every reason this run cannot be accepted (empty = plausible). */
export function checkRun(r: RunClaim, now: number): string[] {
  const errors: string[] = [];
  const finite = (v: number) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (![r.score, r.distance, r.coins, r.duration].every(finite)) return ["numbers must be finite and non-negative"];
  if (!periodIsLive(r.board, r.period, now)) errors.push(`period ${r.period || "(season)"} is not live for ${r.board}`);
  const seed = expectedSeed(r.board, r.period);
  if (seed !== null && (r.seed >>> 0) !== seed) errors.push("seed does not match the board's seed");
  if (r.duration > LIMITS.maxDuration) errors.push("run too long");
  if (r.distance > r.duration * LIMITS.maxSpeed + 50) errors.push("distance impossible for the run time");
  if (r.score > (r.distance + 50) * LIMITS.maxScorePerMetre) errors.push("score impossible for the distance");
  if (r.coins > r.distance * LIMITS.maxCoinsPerMetre + 100) errors.push("coins impossible for the distance");
  return errors;
}
