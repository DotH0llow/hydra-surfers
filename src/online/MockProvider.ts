/**
 * MockProvider: a seeded fake league stored locally, with realistic latency jitter.
 * Skeleton for lane C (C6) — deterministic fake players per seed/scope, local best score persisted.
 */
import { Rng, hash32 } from "../core/rng";
import type { StorageLike } from "../core/store";
import {
  nextWeeklyReset,
  type Board,
  type BoardScope,
  type LeaderboardEntry,
  type LeaderboardService,
  type PlayerSummary,
  type ScoreSubmission,
  type SubmitResult,
} from "./LeaderboardService";

export interface MockProviderOptions {
  /** League seed (same seed → same fake players). */
  seed?: number;
  playerId: string;
  playerName: string;
  storage?: StorageLike | null;
  /** [min, max] simulated latency in ms (0,0 in tests). */
  latencyMs?: [number, number];
  /** Fake players per scope. */
  leagueSize?: number;
  /** Clock (tests). */
  now?: () => number;
}

interface MockSaved {
  best: number;
  weeklyBest: number;
  week: number;
}

const SYLLABLES = ["ka", "zo", "ri", "mek", "lu", "tan", "vi", "po", "sha", "dex", "nor", "bi", "jax", "el", "quin", "ro", "fen", "ta"];
const STORAGE_KEY = "hydra-surfers.mock-board";

export class MockProvider implements LeaderboardService {
  readonly id = "mock" as const;
  private readonly seed: number;
  private readonly latency: [number, number];
  private readonly size: number;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly jitter: Rng;
  private saved: MockSaved;

  constructor(private readonly opts: MockProviderOptions) {
    this.seed = (opts.seed ?? 1) >>> 0;
    this.latency = opts.latencyMs ?? [80, 260];
    this.size = opts.leagueSize ?? 120;
    this.storage = opts.storage ?? null;
    this.now = opts.now ?? (() => Date.now());
    this.jitter = new Rng(hash32(this.seed ^ 0x5eed));
    this.saved = this.load();
  }

  async submitScore(sub: ScoreSubmission): Promise<SubmitResult> {
    await this.delay();
    const score = Math.max(0, Math.floor(sub.score));
    this.rollWeek();
    this.saved.best = Math.max(this.saved.best, score);
    this.saved.weeklyBest = Math.max(this.saved.weeklyBest, score);
    this.persist();
    return { accepted: true, rank: this.rankOf("global", this.saved.best), best: this.saved.best, provider: "mock" };
  }

  async getBoard(scope: BoardScope, around?: string): Promise<Board> {
    await this.delay();
    this.rollWeek();
    const myScore = scope === "weekly" ? this.saved.weeklyBest : this.saved.best;
    const rows = this.league(scope).map((r) => ({ ...r }));
    if (myScore > 0) rows.push({ rank: 0, playerId: this.opts.playerId, name: this.opts.playerName, score: myScore, isMe: true });
    rows.sort((a, b) => b.score - a.score || (a.isMe ? -1 : b.isMe ? 1 : 0));
    rows.forEach((r, i) => (r.rank = i + 1));
    const me = rows.find((r) => r.isMe) ?? null;
    let entries = rows.slice(0, 50);
    if (around) {
      const i = rows.findIndex((r) => r.playerId === around);
      if (i >= 0) entries = rows.slice(Math.max(0, i - 5), i + 6);
    }
    return { scope, entries, me, resetsAt: scope === "weekly" ? nextWeeklyReset(this.now()) : null, provider: "mock" };
  }

  async getProfile(): Promise<PlayerSummary> {
    await this.delay();
    return {
      playerId: this.opts.playerId,
      name: this.opts.playerName,
      bestScore: this.saved.best,
      globalRank: this.saved.best > 0 ? this.rankOf("global", this.saved.best) : null,
    };
  }

  /** Deterministic fake players for a scope (weekly rotates with the week number). */
  league(scope: BoardScope): LeaderboardEntry[] {
    const salt = scope === "global" ? 1 : scope === "weekly" ? 1000 + this.weekIndex() : 2;
    const rng = new Rng(hash32(this.seed ^ Math.imul(salt, 0x9e3779b1)));
    const n = scope === "friends" ? 12 : this.size;
    const scale = scope === "global" ? 60000 : scope === "weekly" ? 22000 : 15000;
    const out: LeaderboardEntry[] = [];
    for (let i = 0; i < n; i++) {
      const syll = rng.int(2, 3);
      let name = "";
      for (let k = 0; k < syll; k++) name += SYLLABLES[rng.int(0, SYLLABLES.length - 1)];
      name = name[0].toUpperCase() + name.slice(1) + (rng.chance(0.4) ? String(rng.int(1, 99)) : "");
      // heavy-tailed: most players low, a few very high
      const u = rng.next();
      const score = Math.floor(scale * Math.pow(u, 3) + rng.int(200, 1500));
      out.push({ rank: 0, playerId: `mock-${salt}-${i}`, name, score });
    }
    return out;
  }

  private rankOf(scope: BoardScope, score: number): number {
    return this.league(scope).filter((r) => r.score > score).length + 1;
  }

  private weekIndex(): number {
    return Math.floor((nextWeeklyReset(this.now()) - 1) / (7 * 86_400_000));
  }

  private rollWeek(): void {
    const w = this.weekIndex();
    if (this.saved.week !== w) {
      this.saved.week = w;
      this.saved.weeklyBest = 0;
    }
  }

  private delay(): Promise<void> {
    const [min, max] = this.latency;
    if (max <= 0) return Promise.resolve();
    return new Promise((res) => setTimeout(res, this.jitter.range(min, max)));
  }

  private load(): MockSaved {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as Partial<MockSaved>;
        return { best: Number(v.best) || 0, weeklyBest: Number(v.weeklyBest) || 0, week: Number(v.week) || 0 };
      }
    } catch {
      /* corrupt → fresh */
    }
    return { best: 0, weeklyBest: 0, week: this.weekIndex() };
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.saved));
    } catch {
      /* storage full / private mode */
    }
  }
}
