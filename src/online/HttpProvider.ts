/**
 * Http leaderboard provider (PLAN.md §7): talks to worker/ (`POST /api/scores`, `GET /api/leaderboard`)
 * and degrades to `fallback` (the mock league) on 503 (no D1 bound), non-OK answers or network errors.
 * Lane C owns this file; extend additively.
 */
import type { Board, BoardScope, LeaderboardService, PlayerSummary, ScoreSubmission, SubmitResult } from "./LeaderboardService";

export interface Identity {
  playerId: string;
  playerName: string;
}

export class HttpProvider implements LeaderboardService {
  readonly id = "http" as const;
  constructor(
    private readonly identity: Identity,
    private readonly fallback: LeaderboardService,
    private readonly base = "",
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  async submitScore(sub: ScoreSubmission): Promise<SubmitResult> {
    // Always record locally too, so a later fallback board still shows the player's best.
    const local = await this.fallback.submitScore(sub);
    try {
      const res = await this.fetchImpl(`${this.base}/api/scores`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: this.identity.playerId, name: this.identity.playerName, ...sub }),
      });
      if (!res.ok) return local;
      const body = (await res.json()) as { rank?: number };
      return { accepted: true, rank: body.rank ?? null, best: local.best, provider: "http" };
    } catch {
      return local;
    }
  }

  async getBoard(scope: BoardScope, around?: string): Promise<Board> {
    if (scope === "friends") return this.fallback.getBoard(scope, around);
    try {
      const q = new URLSearchParams({ scope, player: this.identity.playerId });
      const res = await this.fetchImpl(`${this.base}/api/leaderboard?${q}`);
      if (!res.ok) return this.fallback.getBoard(scope, around);
      const body = (await res.json()) as { entries: Board["entries"]; me: { rank: number; score: number } | null };
      const entries = body.entries.map((e) => ({ ...e, isMe: e.playerId === this.identity.playerId }));
      const me = body.me ? { rank: body.me.rank, score: body.me.score, playerId: this.identity.playerId, name: this.identity.playerName, isMe: true } : null;
      return { scope, entries, me, resetsAt: null, provider: "http" };
    } catch {
      return this.fallback.getBoard(scope, around);
    }
  }

  async getProfile(): Promise<PlayerSummary> {
    const board = await this.getBoard("global");
    const local = await this.fallback.getProfile();
    return { ...local, globalRank: board.me?.rank ?? local.globalRank };
  }
}
