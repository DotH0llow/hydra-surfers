/**
 * Online contract. UI talks only to this interface; the provider is chosen at build time by
 * `VITE_ONLINE_PROVIDER=mock|http` (see ./index.ts and docs/ONLINE.md).
 *
 * Boards are identified the same way the modes and the Worker identify them:
 *   "season"          every ranked run of the current season
 *   "daily"           the Corrida do Dia of one local day (period "2026-09-15")
 *   "weekly"          the weekly challenge of one week (period "2026-W38")
 *   "event:<id>"      a tournament (period = its id)
 * and can be ranked by a metric (score by default; distance, coins, combo, clean for records).
 */

export type ProviderId = "mock" | "http";
export type Metric = "score" | "distance" | "coins" | "combo" | "clean";

export interface Identity {
  playerId: string;
  playerName: string;
  /** Bearer token issued by the server; also the player's recovery code. */
  token?: string;
  /** True once the player chose the name (the tavern asks on the first visit). */
  named?: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  name: string;
  /** Value of the board's metric (score, metres, coins …). */
  score: number;
  /** Crest as "field.charge.border.colours". */
  crest?: string;
  title?: string;
  level?: number;
  /** True for the local player's row. */
  isMe?: boolean;
}

export interface Board {
  board: string;
  period: string;
  metric: Metric;
  /** Ranked rows, top of the board. */
  entries: LeaderboardEntry[];
  /** The local player's row even when outside `entries` (null before their first ranked run). */
  me: LeaderboardEntry | null;
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
  /** Contracts completed by this run (community bounty). */
  contracts?: number;
  /** What ended the run (balance metrics). */
  cause?: string;
  /** House the run is run for ('' = none). */
  house?: string;
  /** Ghost track of this run (src/shared/ghost.ts); sent with a new daily best only. */
  ghost?: string;
}

/** Someone's ghost to race against. */
export interface GhostData {
  playerId: string;
  name: string;
  score: number;
  /** Encoded track (src/shared/ghost.ts). */
  data: string;
}

/** One house's weekly standing (see HOUSES in the season content). */
export interface HouseStanding {
  house: string;
  /** Mean of the house's five best weekly scores. */
  value: number;
  players: number;
}

export interface SubmitResult {
  accepted: boolean;
  /** Whether the run counted for its board. */
  ranked: boolean;
  /** Rank on the run's board after submitting (null if unknown). */
  rank: number | null;
  /** Rank before this run (null if the player was not on the board). */
  previousRank: number | null;
  /** Personal best on that board after submitting. */
  best: number;
  /** The player right above, for "X pontos atrás de Fulano". */
  above: { name: string; value: number } | null;
  provider: ProviderId;
}

export interface CommunityState {
  id: string;
  value: number;
  goal: number;
}

export interface Community {
  /** The bounty running now (progress bar), or null. */
  active: CommunityState | null;
  /** Every bounty started this season, finished ones included (their rewards are claimable). */
  bounties: CommunityState[];
}

export interface PublicProfile {
  crest: string;
  title: string;
  level: number;
}

export interface LeaderboardService {
  readonly id: ProviderId;
  identity(): Identity;
  submitScore(submission: ScoreSubmission): Promise<SubmitResult>;
  getBoard(board: string, period?: string, metric?: Metric): Promise<Board>;
  /** Changes the display name. Resolves with an error code when it is invalid or taken. */
  rename(name: string): Promise<{ ok: boolean; error?: "invalid" | "taken" | "offline" }>;
  /** Pushes what other players see next to the name (crest, title, level). */
  updateProfile(profile: PublicProfile): Promise<void>;
  /** Community bounty progress, or null offline / when none is running. */
  /** Community bounties: the running one and every one started this season; null offline. */
  community(): Promise<Community | null>;
  /** Restores an identity from a recovery code on a new device. */
  recover(code: string): Promise<boolean>;
  /** Weekly house standings, or null offline. */
  houses(period: string): Promise<HouseStanding[] | null>;
  /** The ghost to race on a seeded board: the player just above you (see worker), or null. */
  getGhost(board: string, period: string): Promise<GhostData | null>;
}
