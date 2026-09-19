/**
 * MockProvider: an offline league of group-sized fake players, stored locally, with realistic
 * latency jitter. It keeps every screen (boards, rival lines, results) working without a server,
 * and it is what the http provider falls back to when the API is unreachable.
 */
import { Rng, hash32 } from "../core/rng";
import type { StorageLike } from "../core/store";
import { hashString } from "../shared/hash";
import { validName } from "../shared/plausibility";
import type { Board, CommunityState, HouseStanding, Identity, LeaderboardEntry, LeaderboardService, Metric, PublicProfile, ScoreSubmission, SubmitResult } from "./LeaderboardService";

export interface MockProviderOptions {
  /** League seed (same seed → same fake players). */
  seed?: number;
  identity: Identity;
  storage?: StorageLike | null;
  /** [min, max] simulated latency in ms (0,0 in tests). */
  latencyMs?: [number, number];
  /** Fake players per board (a private group is ~30-40 people). */
  leagueSize?: number;
  /** Called when the identity changes (rename). */
  onIdentity?: (id: Identity) => void;
}

type Bests = Record<Metric, number>;

const STORAGE_KEY = "hydra-surfers.mock-board";
const NAMES = [
  "Arthur", "Marina", "Lucas", "Beatriz", "Rafael", "Helena", "Tomás", "Isadora", "Gabriel", "Lívia",
  "Heitor", "Clara", "Bernardo", "Alice", "Davi", "Laura", "Mateus", "Sofia", "Joaquim", "Valentina",
  "Caio", "Manuela", "Enzo", "Cecília", "Otávio", "Luísa", "Vicente", "Aurora", "Benício", "Elisa",
  "Samuel", "Yasmin", "Pietro", "Olívia", "Murilo", "Antonella", "Lorenzo", "Maitê", "Nicolas", "Iris",
];

/** Scale of each metric in the fake league, so records boards look like records boards. */
const SCALE: Record<Metric, number> = { score: 60000, distance: 9000, coins: 1400, combo: 90, clean: 3500 };

const METRIC_OF: Record<Metric, (s: ScoreSubmission) => number> = {
  score: (s) => s.score,
  distance: (s) => s.distance,
  coins: (s) => s.coins,
  combo: (s) => s.maxCombo ?? 0,
  clean: (s) => s.cleanDistance ?? 0,
};

export class MockProvider implements LeaderboardService {
  readonly id = "mock" as const;
  private readonly seed: number;
  private readonly latency: [number, number];
  private readonly size: number;
  private readonly storage: StorageLike | null;
  private readonly jitter: Rng;
  private me: Identity;
  private saved: Record<string, Bests>;

  constructor(private readonly opts: MockProviderOptions) {
    this.seed = (opts.seed ?? 1) >>> 0;
    this.latency = opts.latencyMs ?? [80, 260];
    this.size = opts.leagueSize ?? 36;
    this.storage = opts.storage ?? null;
    this.jitter = new Rng(hash32(this.seed ^ 0x5eed));
    this.me = opts.identity;
    this.saved = this.load();
  }

  identity(): Identity {
    return this.me;
  }

  async submitScore(sub: ScoreSubmission): Promise<SubmitResult> {
    await this.delay();
    const key = boardKey(sub.board ?? "season", sub.period ?? "");
    const before = this.saved[key] ? { ...this.saved[key] } : null;
    const ranked = sub.ranked !== false;
    if (ranked) {
      const cur = this.saved[key] ?? { score: 0, distance: 0, coins: 0, combo: 0, clean: 0 };
      for (const m of Object.keys(METRIC_OF) as Metric[]) cur[m] = Math.max(cur[m], Math.floor(METRIC_OF[m](sub)));
      this.saved[key] = cur;
      this.persist();
    }
    const board = sub.board ?? "season";
    const period = sub.period ?? "";
    const league = this.league(board, period, "score");
    const best = this.saved[key]?.score ?? 0;
    const rankOf = (v: number) => league.filter((r) => r.score > v).length + 1;
    const above = best > 0 ? league.filter((r) => r.score > best).sort((a, b) => a.score - b.score)[0] : undefined;
    return {
      accepted: true,
      ranked,
      rank: best > 0 ? rankOf(best) : null,
      previousRank: before && before.score > 0 ? rankOf(before.score) : null,
      best,
      above: above ? { name: above.name, value: above.score } : null,
      provider: "mock",
    };
  }

  async getBoard(board: string, period = "", metric: Metric = "score"): Promise<Board> {
    await this.delay();
    const rows: LeaderboardEntry[] = this.league(board, period, metric).map((r) => ({ ...r }));
    const mine = this.saved[boardKey(board, period)]?.[metric] ?? 0;
    if (mine > 0) rows.push({ rank: 0, playerId: this.me.playerId, name: this.me.playerName, score: mine, isMe: true });
    rows.sort((a, b) => b.score - a.score || (a.isMe ? -1 : b.isMe ? 1 : 0));
    rows.forEach((r, i) => (r.rank = i + 1));
    return { board, period, metric, entries: rows.slice(0, 50), me: rows.find((r) => r.isMe) ?? null, provider: "mock" };
  }

  async rename(name: string): Promise<{ ok: boolean; error?: "invalid" | "taken" | "offline" }> {
    const clean = validName(name);
    if (!clean) return { ok: false, error: "invalid" };
    this.me = { ...this.me, playerName: clean, named: true };
    this.opts.onIdentity?.(this.me);
    return { ok: true };
  }

  async updateProfile(_profile: PublicProfile): Promise<void> {}

  async community(): Promise<CommunityState | null> {
    return null;
  }

  async houses(_period: string): Promise<HouseStanding[] | null> {
    return null;
  }

  async recover(_code: string): Promise<boolean> {
    return false;
  }

  /** Deterministic fake players for a board, period and metric. */
  league(board: string, period: string, metric: Metric): LeaderboardEntry[] {
    const rng = new Rng(hash32(this.seed ^ hashString(`${board}|${period}|${metric}`)));
    // daily boards are thinner: not everybody plays every day
    const n = board === "season" ? this.size : Math.round(this.size * (0.45 + rng.next() * 0.3));
    const scale = SCALE[metric] * (board === "season" ? 1 : 0.55);
    const out: LeaderboardEntry[] = [];
    for (let i = 0; i < n; i++) {
      const name = NAMES[(i + (this.seed % NAMES.length)) % NAMES.length];
      const u = rng.next();
      out.push({ rank: 0, playerId: `mock-${i}`, name, score: Math.floor(scale * Math.pow(u, 2.2) + scale * 0.02 * rng.next()) });
    }
    return out;
  }

  private delay(): Promise<void> {
    const [min, max] = this.latency;
    if (max <= 0) return Promise.resolve();
    return new Promise((res) => setTimeout(res, this.jitter.range(min, max)));
  }

  private load(): Record<string, Bests> {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as unknown;
        if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, Bests>;
      }
    } catch {
      /* corrupt → fresh */
    }
    return {};
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.saved));
    } catch {
      /* storage full / private mode */
    }
  }
}

function boardKey(board: string, period: string): string {
  return `${board}|${period}`;
}
