/**
 * Http provider: talks to worker/ and degrades to `fallback` (the offline league) whenever the API
 * answers 503 (no D1 bound), fails, or is unreachable — the UI always has something to show.
 *
 * Registration is lazy: the first time the player submits a run (or renames), the provider creates
 * the server-side player with the current name and keeps the returned token. That token signs
 * every write and is also the recovery code shown in the settings.
 */
import type {
  Board,
  CommunityState,
  Identity,
  LeaderboardService,
  Metric,
  PublicProfile,
  ScoreSubmission,
  SubmitResult,
} from "./LeaderboardService";

type Fetch = typeof fetch;

export class HttpProvider implements LeaderboardService {
  readonly id = "http" as const;
  private me: Identity;
  private registering: Promise<boolean> | null = null;

  constructor(
    identity: Identity,
    private readonly fallback: LeaderboardService,
    private readonly save: (id: Identity) => void,
    private readonly base = "",
    private readonly fetchImpl: Fetch = (...a) => fetch(...a),
  ) {
    this.me = identity;
  }

  identity(): Identity {
    return this.me;
  }

  async submitScore(sub: ScoreSubmission): Promise<SubmitResult> {
    // always record locally too, so a later fallback board still shows the player's bests
    const local = await this.fallback.submitScore(sub);
    try {
      if (!(await this.ensureRegistered())) return local;
      const res = await this.call("/api/runs", "POST", {
        board: sub.board ?? "season",
        period: sub.period ?? "",
        seed: sub.seed ?? 0,
        score: sub.score,
        distance: sub.distance,
        coins: sub.coins,
        duration: sub.duration ?? 0,
        ranked: sub.ranked !== false,
        maxCombo: sub.maxCombo ?? 0,
        cleanDistance: sub.cleanDistance ?? 0,
        contracts: sub.contracts ?? 0,
        cause: sub.cause ?? "",
      });
      if (!res.ok) return local;
      const body = (await res.json()) as Omit<SubmitResult, "provider">;
      return { ...body, provider: "http" };
    } catch {
      return local;
    }
  }

  async getBoard(board: string, period = "", metric: Metric = "score"): Promise<Board> {
    try {
      const q = new URLSearchParams({ period, metric, player: this.me.playerId });
      const res = await this.fetchImpl(`${this.base}/api/boards/${encodeURIComponent(board)}?${q}`);
      if (!res.ok) return this.fallback.getBoard(board, period, metric);
      const body = (await res.json()) as {
        entries: Array<{ rank: number; playerId: string; name: string; value: number; crest?: string; title?: string; level?: number }>;
        me: { rank: number; value: number } | null;
      };
      const entries = body.entries.map((e) => ({ rank: e.rank, playerId: e.playerId, name: e.name, score: e.value, crest: e.crest, title: e.title, level: e.level, isMe: e.playerId === this.me.playerId }));
      const me = body.me ? { rank: body.me.rank, score: body.me.value, playerId: this.me.playerId, name: this.me.playerName, isMe: true } : null;
      return { board, period, metric, entries, me, provider: "http" };
    } catch {
      return this.fallback.getBoard(board, period, metric);
    }
  }

  async rename(name: string): Promise<{ ok: boolean; error?: "invalid" | "taken" | "offline" }> {
    const local = await this.fallback.rename(name);
    if (!local.ok) return local;
    const clean = this.fallback.identity().playerName;
    try {
      if (!this.me.token) {
        this.me = { ...this.me, playerName: clean };
        const ok = await this.ensureRegistered();
        return ok ? { ok: true } : { ok: false, error: "taken" };
      }
      const res = await this.call("/api/players/me", "PUT", { name: clean });
      if (res.status === 409) return { ok: false, error: "taken" };
      if (!res.ok) return { ok: false, error: "offline" };
      this.remember({ ...this.me, playerName: clean });
      return { ok: true };
    } catch {
      return { ok: false, error: "offline" };
    }
  }

  async updateProfile(profile: PublicProfile): Promise<void> {
    try {
      if (!this.me.token) return;
      await this.call("/api/players/me", "PUT", profile);
    } catch {
      /* offline: pushed again after the next run */
    }
  }

  async community(): Promise<CommunityState | null> {
    try {
      const res = await this.fetchImpl(`${this.base}/api/community`);
      if (!res.ok) return null;
      const body = (await res.json()) as { bounty: CommunityState | null };
      return body.bounty;
    } catch {
      return null;
    }
  }

  async recover(code: string): Promise<boolean> {
    const token = code.trim().toUpperCase();
    try {
      const res = await this.fetchImpl(`${this.base}/api/players/me`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return false;
      const body = (await res.json()) as { playerId: string; name: string };
      this.remember({ playerId: body.playerId, playerName: body.name, token });
      return true;
    } catch {
      return false;
    }
  }

  /** Creates the server-side player the first time it is needed. Retries a taken name with digits. */
  private ensureRegistered(): Promise<boolean> {
    if (this.me.token) return Promise.resolve(true);
    this.registering ??= (async () => {
      let name = this.me.playerName;
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await this.call("/api/players", "POST", { name });
        if (res.status === 201) {
          const body = (await res.json()) as { playerId: string; token: string; name: string };
          this.remember({ playerId: body.playerId, playerName: body.name, token: body.token });
          return true;
        }
        if (res.status !== 409) return false;
        name = `${this.me.playerName.slice(0, 12)} ${10 + Math.floor(Math.random() * 90)}`;
      }
      return false;
    })().finally(() => (this.registering = null));
    return this.registering;
  }

  private call(path: string, method: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.me.token) headers.authorization = `Bearer ${this.me.token}`;
    return this.fetchImpl(`${this.base}${path}`, { method, headers, body: JSON.stringify(body) });
  }

  private remember(id: Identity): void {
    this.me = id;
    this.save(id);
  }
}
