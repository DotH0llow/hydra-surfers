/**
 * Provider selection: `VITE_ONLINE_PROVIDER=mock` (default) or `http` (the Worker in worker/).
 * The http provider falls back to the mock league whenever the API answers 503 (no D1 bound) or
 * is unreachable, so the leaderboard UI always has data.
 */
import type { StorageLike } from "../core/store";
import type { Board, BoardScope, LeaderboardService, PlayerSummary, ScoreSubmission, SubmitResult } from "./LeaderboardService";
import { MockProvider } from "./MockProvider";

export * from "./LeaderboardService";
export { MockProvider } from "./MockProvider";

export interface Identity {
  playerId: string;
  playerName: string;
}

const ID_KEY = "yard-dash.player";

export function getIdentity(storage: StorageLike | null): Identity {
  try {
    const raw = storage?.getItem(ID_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Identity;
      if (v.playerId && v.playerName) return v;
    }
  } catch {
    /* fresh identity */
  }
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.floor(Math.random() * 2 ** 48).toString(36);
  const id: Identity = { playerId: `p_${rand}`, playerName: `Runner${rand.slice(0, 4).toUpperCase()}` };
  try {
    storage?.setItem(ID_KEY, JSON.stringify(id));
  } catch {
    /* ignore */
  }
  return id;
}

/** Http provider: talks to worker/ and degrades to `fallback` on 503 / network errors. */
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

export function createLeaderboardService(storage: StorageLike | null, provider = import.meta.env.VITE_ONLINE_PROVIDER ?? "mock"): LeaderboardService {
  const identity = getIdentity(storage);
  const mock = new MockProvider({ ...identity, storage, seed: 1 });
  return provider === "http" ? new HttpProvider(identity, mock) : mock;
}
