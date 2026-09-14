/**
 * Yard Dash API Worker (Cloudflare Workers + static assets).
 *
 * wrangler.jsonc routes `/api/*` here first (`assets.run_worker_first`); every other path is served
 * from `dist/` by the assets binding with SPA fallback.
 *
 * Routes
 *   GET  /api/health                         → { ok, db, version, time }
 *   GET  /api/leaderboard?scope=global|weekly&limit=50&player=<id>
 *   POST /api/scores  { playerId, name, score, coins?, distance?, seed? }
 *
 * When no D1 database is bound as `DB`, the leaderboard/score routes answer
 * `503 {"error":"db_unavailable", ...}` so the client falls back to its mock provider
 * (see src/online and docs/ONLINE.md). Schema: worker/schema.sql.
 */

export interface Env {
  /** Optional D1 binding (see wrangler.jsonc + docs/ONLINE.md). */
  DB?: D1Database;
  /** Static assets binding (dist/). */
  ASSETS?: Fetcher;
  /** Optional build/version label shown by /api/health. */
  APP_VERSION?: string;
}

export const API_VERSION = "1";

export const LIMITS = {
  nameMax: 16,
  playerIdMax: 64,
  scoreMax: 1_000_000_000,
  coinsMax: 10_000_000,
  distanceMax: 10_000_000,
  boardDefault: 50,
  boardMax: 100,
} as const;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function dbUnavailable(): Response {
  return json(
    {
      error: "db_unavailable",
      message: "No D1 database is bound to this Worker. Clients should fall back to the mock leaderboard.",
      fallback: "mock",
    },
    503,
    { "retry-after": "3600" },
  );
}

/** ISO week key, e.g. "2026-W37" (weeks start Monday, UTC). */
export function weekKey(ms: number): string {
  const src = new Date(ms);
  const d = new Date(Date.UTC(src.getUTCFullYear(), src.getUTCMonth(), src.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thursday of this ISO week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Removes ASCII control characters (code points < 32 and 127). */
export function stripControl(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 32 && c !== 127) out += ch;
  }
  return out;
}

export interface ScoreInput {
  playerId: string;
  name: string;
  score: number;
  coins: number;
  distance: number;
  seed: number | null;
}

/** Validates a score submission. Returns the cleaned input or a list of problems. */
export function validateScore(raw: unknown): { ok: true; value: ScoreInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, errors: ["body must be a JSON object"] };
  const r = raw as Record<string, unknown>;
  const playerId = typeof r.playerId === "string" ? r.playerId.trim() : "";
  if (!/^[A-Za-z0-9_-]{6,}$/.test(playerId) || playerId.length > LIMITS.playerIdMax) errors.push("playerId: 6-64 chars [A-Za-z0-9_-]");
  const name = typeof r.name === "string" ? stripControl(r.name).trim() : "";
  if (name.length < 1 || name.length > LIMITS.nameMax) errors.push(`name: 1-${LIMITS.nameMax} printable chars`);
  const int = (v: unknown, key: string, max: number, required: boolean): number => {
    if (v === undefined && !required) return 0;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) {
      errors.push(`${key}: number 0-${max}`);
      return 0;
    }
    return v;
  };
  const score = Math.floor(int(r.score, "score", LIMITS.scoreMax, true));
  const coins = Math.floor(int(r.coins, "coins", LIMITS.coinsMax, false));
  const distance = int(r.distance, "distance", LIMITS.distanceMax, false);
  let seed: number | null = null;
  if (r.seed !== undefined && r.seed !== null) {
    if (typeof r.seed !== "number" || !Number.isInteger(r.seed)) errors.push("seed: integer");
    else seed = r.seed >>> 0;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { playerId, name, score, coins, distance, seed } };
}

async function handleLeaderboard(url: URL, db: D1Database): Promise<Response> {
  const scope = url.searchParams.get("scope") ?? "global";
  if (scope !== "global" && scope !== "weekly") {
    return json({ error: "bad_scope", message: "scope must be global or weekly (friends is client-side for now)" }, 400);
  }
  const limitRaw = Number(url.searchParams.get("limit") ?? LIMITS.boardDefault);
  const limit = Math.max(1, Math.min(LIMITS.boardMax, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : LIMITS.boardDefault));
  const week = weekKey(Date.now());
  const where = scope === "weekly" ? "WHERE week = ?1" : "";
  const binds = scope === "weekly" ? [week] : [];
  const rows = await db
    .prepare(
      `SELECT player_id AS playerId, name, MAX(score) AS score, MAX(distance) AS distance, MAX(created_at) AS at
       FROM scores ${where} GROUP BY player_id ORDER BY score DESC, at ASC LIMIT ${limit}`,
    )
    .bind(...binds)
    .all<{ playerId: string; name: string; score: number; distance: number; at: number }>();
  const entries = (rows.results ?? []).map((r, i) => ({ rank: i + 1, ...r }));
  const player = url.searchParams.get("player");
  let me: { rank: number; score: number } | null = null;
  if (player) {
    const best = await db
      .prepare(`SELECT MAX(score) AS score FROM scores ${where ? `${where} AND` : "WHERE"} player_id = ?${binds.length + 1}`)
      .bind(...binds, player)
      .first<{ score: number | null }>();
    if (best && best.score !== null) {
      const above = await db
        .prepare(`SELECT COUNT(*) AS n FROM (SELECT MAX(score) AS s FROM scores ${where} GROUP BY player_id) WHERE s > ?${binds.length + 1}`)
        .bind(...binds, best.score)
        .first<{ n: number }>();
      me = { rank: (above?.n ?? 0) + 1, score: best.score };
    }
  }
  return json({ scope, week: scope === "weekly" ? week : null, entries, me });
}

async function handleScore(request: Request, db: D1Database): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const v = validateScore(body);
  if (!v.ok) return json({ error: "invalid", errors: v.errors }, 422);
  const s = v.value;
  const now = Date.now();
  await db
    .prepare("INSERT INTO scores (player_id, name, score, coins, distance, seed, week, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
    .bind(s.playerId, s.name, s.score, s.coins, s.distance, s.seed, weekKey(now), now)
    .run();
  const above = await db
    .prepare("SELECT COUNT(*) AS n FROM (SELECT MAX(score) AS s FROM scores GROUP BY player_id) WHERE s > ?1")
    .bind(s.score)
    .first<{ n: number }>();
  return json({ ok: true, rank: (above?.n ?? 0) + 1 }, 201);
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
  try {
    if (path === "/api/health") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      return json({ ok: true, db: !!env.DB, version: env.APP_VERSION ?? API_VERSION, time: new Date().toISOString() });
    }
    if (path === "/api/leaderboard") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      if (!env.DB) return dbUnavailable();
      return await handleLeaderboard(url, env.DB);
    }
    if (path === "/api/scores") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
      if (!env.DB) return dbUnavailable();
      return await handleScore(request, env.DB);
    }
    return json({ error: "not_found", path }, 404);
  } catch (err) {
    console.error("[api] error", err);
    return json({ error: "internal", message: String(err instanceof Error ? err.message : err) }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return handleApi(request, env);
    // Only reached if run_worker_first is widened; hand everything else to static assets.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
