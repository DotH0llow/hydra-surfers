/**
 * Online leaderboard contract (PLAN.md §7). UI talks only to this interface; the provider is chosen
 * at build time by `VITE_ONLINE_PROVIDER=mock|http` (see ./index.ts and docs/ONLINE.md).
 *
 * Lane C owns the full implementation (tiers/brackets, rewards, friends); this file is the stable
 * surface other code may depend on. Extend additively.
 */

export type BoardScope = "global" | "weekly" | "friends";
export type ProviderId = "mock" | "http";

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  name: string;
  score: number;
  /** True for the local player's row. */
  isMe?: boolean;
}

export interface Board {
  scope: BoardScope;
  /** Ranked rows (top of the board, or a window around the requested player). */
  entries: LeaderboardEntry[];
  /** The local player's row even when outside `entries` (null before their first score). */
  me: LeaderboardEntry | null;
  /** Unix ms when a weekly board resets; null for non-resetting scopes. */
  resetsAt: number | null;
  /** Which provider actually answered (http falls back to mock when the API is unavailable). */
  provider: ProviderId;
}

export interface ScoreSubmission {
  score: number;
  coins: number;
  distance: number;
  seed?: number;
  /** Board the run counts for ("season" | "daily" | "weekly" | "event:<id>"). */
  board?: string;
  /** Period key of that board. */
  period?: string;
  /** False for practice runs after the ranked attempts are spent. */
  ranked?: boolean;
  /** Run time in seconds (server plausibility checks). */
  duration?: number;
  maxCombo?: number;
  cleanDistance?: number;
  /** What ended the run (balance metrics). */
  cause?: string;
}

export interface SubmitResult {
  accepted: boolean;
  /** Global rank after submitting (null if unknown). */
  rank: number | null;
  /** Best score known for the player after submitting. */
  best: number;
  provider: ProviderId;
}

export interface PlayerSummary {
  playerId: string;
  name: string;
  bestScore: number;
  globalRank: number | null;
}

export interface LeaderboardService {
  readonly id: ProviderId;
  submitScore(submission: ScoreSubmission): Promise<SubmitResult>;
  /** `around`: a playerId to centre the returned window on (default: top of the board). */
  getBoard(scope: BoardScope, around?: string): Promise<Board>;
  getProfile(): Promise<PlayerSummary>;
}

/** Next Monday 00:00 UTC after `now` (weekly board reset). */
export function nextWeeklyReset(now: number): number {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7; // Mon = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 7);
}
