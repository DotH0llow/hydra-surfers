/**
 * Hydra Surfers API Worker (Cloudflare Workers + static assets + D1).
 *
 * wrangler.jsonc routes `/api/*` here first (`assets.run_worker_first`); every other path is served
 * from `dist/` by the assets binding with SPA fallback.
 *
 * Built for one private group of ~40 players, so it stays small on purpose:
 *   - identity is a unique name plus a random token (the token doubles as the recovery code);
 *     every write needs `Authorization: Bearer <token>`, so nobody can post as someone else;
 *   - every run is one row; boards are GROUP BY queries over those rows (40 players x a few
 *     runs a day is a tiny table for SQLite);
 *   - plausibility checks live in src/shared/plausibility.ts, shared with the client.
 *
 * Routes
 *   GET  /api/health
 *   POST /api/players                 { name, crest? }                  -> 201 { playerId, token }
 *   GET  /api/players/me              (auth)                           -> { playerId, name, crest, title, level }
 *   PUT  /api/players/me              (auth) { name?, crest?, title?, level?, house?, build?, showcase? }
 *   GET  /api/players/:id                                              -> public card (profile + season bests)
 *   POST /api/runs                    (auth) run claim + extras        -> 201 { accepted, ranked, rank, previousRank, best, above }
 *   GET  /api/boards/:board?period=&metric=&player=                    -> { entries, me }
 *   GET  /api/community                                                -> { bounty: { id, value, goal } | null, bounties: [...] }
 *   GET  /api/houses?period=<week>                                     -> { period, standings: [{ house, value, players }] }
 *   GET  /api/ghosts/daily?period=&player=                             -> { playerId, name, score, data } | 404
 *
 * Without a D1 binding every data route answers `503 {"error":"db_unavailable"}` and the client
 * falls back to its offline league. Schema: worker/schema.sql.
 */
import { dayIndex, dayStart } from "../src/shared/calendar";
import { DAILY_ATTEMPTS, HOUSES, SEASON, TOURNAMENTS, WEEKLY_ATTEMPTS, activeBounty, houseById, houseScore, seasonStartDay, startedBounties, type BountyDef } from "../src/shared/content/season";
import { LIMITS, checkRun, nameKey, validName, type RunClaim } from "../src/shared/plausibility";
import { GHOST_MAX_CHARS, decodeGhost, ghostMatchesRun } from "../src/shared/ghost";

export interface Env {
  /** D1 binding (see wrangler.jsonc + docs/ONLINE.md). */
  DB?: D1Database;
  /** Static assets binding (dist/). */
  ASSETS?: Fetcher;
  /** Optional build/version label shown by /api/health. */
  APP_VERSION?: string;
}

export const API_VERSION = "2";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
} as const;

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function dbUnavailable(): Response {
  return json({ error: "db_unavailable", message: "No D1 database is bound to this Worker. Clients fall back to the offline league.", fallback: "mock" }, 503, { "retry-after": "3600" });
}

/** Board columns a leaderboard can be ranked by. */
/** How each board metric aggregates a player's runs: a best, or (contracts) a season total. */
export const METRICS = {
  score: "MAX(score)",
  distance: "MAX(distance)",
  coins: "MAX(coins)",
  combo: "MAX(max_combo)",
  clean: "MAX(clean)",
  contracts: "SUM(contracts)",
} as const;
export type Metric = keyof typeof METRICS;

/** Ranked attempts a player gets on a board per period (0 = unlimited). */
export function attemptLimit(board: string): number {
  if (board === "daily") return DAILY_ATTEMPTS;
  if (board === "weekly") return WEEKLY_ATTEMPTS;
  if (board.startsWith("event:")) return TOURNAMENTS.find((t) => `event:${t.id}` === board)?.attempts ?? 0;
  return 0;
}

// ---------------------------------------------------------------------------- auth

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  // Crockford-ish base32 without look-alikes: easy to type as a recovery code
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}`;
}

function bearer(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  return m ? m[1].trim().toUpperCase() : null;
}

interface PlayerRow {
  id: string;
  name: string;
  crest: string;
  title: string;
  level: number;
  house: string;
  build: string;
  showcase: string;
}

async function authPlayer(request: Request, db: D1Database): Promise<PlayerRow | null> {
  const token = bearer(request);
  if (!token) return null;
  return db.prepare("SELECT id, name, crest, title, level, house, build, showcase FROM players WHERE token_hash = ?1").bind(await sha256(token)).first<PlayerRow>();
}

/** Bodies are small JSON objects; a run may carry a ghost track. */
const MAX_BODY = 8 * 1024;
const MAX_RUN_BODY = GHOST_MAX_CHARS + 8 * 1024;

async function readJson(request: Request, maxChars = MAX_BODY): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > maxChars) return null;
    const body = JSON.parse(text) as unknown;
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A short list of content ids (items, achievements) stored comma-joined; anything odd is dropped. */
function cleanIds(raw: unknown, max: number): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .filter((v): v is string => typeof v === "string" && /^[a-z0-9._-]{1,40}$/.test(v))
    .slice(0, max)
    .join(",");
}

/** Crest is stored as the four indices joined with dots ("2.5.0.3"). */
function cleanCrest(raw: unknown): string {
  if (typeof raw !== "string") return "0.1.0.0";
  return /^\d{1,2}\.\d{1,2}\.\d{1,2}\.\d{1,2}$/.test(raw) ? raw : "0.1.0.0";
}

// ---------------------------------------------------------------------------- players

async function createPlayer(request: Request, db: D1Database): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ error: "bad_json" }, 400);
  const name = validName(body.name);
  if (!name) return json({ error: "invalid_name", message: `Nome: ${LIMITS.nameMin}-${LIMITS.nameMax} letras, números ou espaços.` }, 422);
  const key = nameKey(name);
  const taken = await db.prepare("SELECT 1 AS x FROM players WHERE name_key = ?1").bind(key).first();
  if (taken) return json({ error: "name_taken" }, 409);
  const id = `p_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const token = newToken();
  const now = Date.now();
  await db
    .prepare("INSERT INTO players (id, name, name_key, token_hash, crest, title, level, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, '', 1, ?6, ?6)")
    .bind(id, name, key, await sha256(token), cleanCrest(body.crest), now)
    .run();
  return json({ playerId: id, token, name }, 201);
}

async function updatePlayer(request: Request, db: D1Database, me: PlayerRow): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ error: "bad_json" }, 400);
  let name = me.name;
  if (body.name !== undefined) {
    const next = validName(body.name);
    if (!next) return json({ error: "invalid_name" }, 422);
    if (nameKey(next) !== nameKey(me.name)) {
      const taken = await db.prepare("SELECT 1 AS x FROM players WHERE name_key = ?1").bind(nameKey(next)).first();
      if (taken) return json({ error: "name_taken" }, 409);
    }
    name = next;
  }
  const crest = body.crest !== undefined ? cleanCrest(body.crest) : me.crest;
  const title = typeof body.title === "string" && /^[a-z0-9._-]{0,40}$/.test(body.title) ? body.title : me.title;
  const level = typeof body.level === "number" && Number.isFinite(body.level) ? Math.max(1, Math.min(999, Math.floor(body.level))) : me.level;
  const house = typeof body.house === "string" ? (houseById(body.house) ? body.house : "") : me.house;
  const build = body.build !== undefined ? cleanIds(body.build, 3) : me.build;
  const showcase = body.showcase !== undefined ? cleanIds(body.showcase, 3) : me.showcase;
  await db
    .prepare("UPDATE players SET name = ?2, name_key = ?3, crest = ?4, title = ?5, level = ?6, house = ?7, build = ?8, showcase = ?9, updated_at = ?10 WHERE id = ?1")
    .bind(me.id, name, nameKey(name), crest, title, level, house, build, showcase, Date.now())
    .run();
  return json({ playerId: me.id, name, crest, title, level });
}

// ---------------------------------------------------------------------------- runs

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : Number.NaN;
}

/** Best value and rank of a player on a board (null rank = no ranked run yet). */
async function standing(db: D1Database, board: string, period: string, metric: Metric, playerId: string): Promise<{ best: number; rank: number | null }> {
  const agg = METRICS[metric];
  const { where, binds } = boardFilter(board, period);
  const mine = await db
    .prepare(`SELECT ${agg} AS v FROM runs WHERE ${where} AND player_id = ?${binds.length + 1}`)
    .bind(...binds, playerId)
    .first<{ v: number | null }>();
  if (!mine || mine.v === null) return { best: 0, rank: null };
  const above = await db
    .prepare(`SELECT COUNT(*) AS n FROM (SELECT ${agg} AS v FROM runs WHERE ${where} GROUP BY player_id) WHERE v > ?${binds.length + 1}`)
    .bind(...binds, mine.v)
    .first<{ n: number }>();
  return { best: mine.v, rank: (above?.n ?? 0) + 1 };
}

/** SQL filter for a board: the season board spans every ranked run of the season. */
function boardFilter(board: string, period: string): { where: string; binds: unknown[] } {
  if (board === "season") return { where: "season = ?1 AND ranked = 1", binds: [SEASON.id] };
  return { where: "board = ?1 AND period = ?2 AND ranked = 1", binds: [board, period] };
}

async function submitRun(request: Request, db: D1Database, me: PlayerRow): Promise<Response> {
  const body = await readJson(request, MAX_RUN_BODY);
  if (!body) return json({ error: "bad_json" }, 400);
  const board = typeof body.board === "string" ? body.board : "season";
  const period = typeof body.period === "string" ? body.period : "";
  const claim: RunClaim = { board, period, seed: Math.floor(num(body.seed)) >>> 0, score: Math.floor(num(body.score)), distance: num(body.distance), coins: Math.floor(num(body.coins)), duration: num(body.duration) };
  const now = Date.now();
  const errors = checkRun(claim, now);
  if (errors.length) return json({ error: "implausible", errors }, 422);

  // ranked attempts are capped per period; extra runs are kept, just not ranked
  let ranked = body.ranked === false ? 0 : 1;
  const limit = attemptLimit(board);
  if (ranked && limit > 0) {
    const used = await db.prepare("SELECT COUNT(*) AS n FROM runs WHERE player_id = ?1 AND board = ?2 AND period = ?3 AND ranked = 1").bind(me.id, board, period).first<{ n: number }>();
    if ((used?.n ?? 0) >= limit) ranked = 0;
  }

  const before = await standing(db, board, period, "score", me.id);
  const clampInt = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number.isFinite(num(v)) ? num(v) : 0)));
  await db
    .prepare(
      "INSERT INTO runs (player_id, season, board, period, seed, score, distance, coins, duration, max_combo, clean, contracts, cause, ranked, house, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
    )
    .bind(
      me.id,
      SEASON.id,
      board,
      period,
      claim.seed,
      claim.score,
      claim.distance,
      claim.coins,
      claim.duration,
      clampInt(body.maxCombo, 100000),
      Math.max(0, Math.min(claim.distance, num(body.cleanDistance) || 0)),
      clampInt(body.contracts, 50),
      typeof body.cause === "string" ? body.cause.slice(0, 24) : "",
      ranked,
      typeof body.house === "string" && houseById(body.house) ? body.house : "",
      now,
    )
    .run();
  const after = await standing(db, board, period, "score", me.id);

  // a ranked run on a seeded board may carry its ghost; it is kept while it is the player's best
  let ghostStored = false;
  if (limit > 0 && ranked && typeof body.ghost === "string") {
    const track = decodeGhost(body.ghost);
    if (track && ghostMatchesRun(track, claim.duration, claim.distance)) {
      const res = await db
        .prepare(
          "INSERT INTO ghosts (player_id, board, period, score, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (player_id, board, period) DO UPDATE SET score = excluded.score, data = excluded.data, created_at = excluded.created_at WHERE excluded.score > ghosts.score",
        )
        .bind(me.id, board, period, claim.score, body.ghost, now)
        .run();
      ghostStored = (res.meta?.changes ?? 0) > 0;
    }
  }

  // who this run overtook (only when the player was already on the board and improved)
  let passed: string[] = [];
  if (before.rank !== null && after.best > before.best) {
    const { where, binds } = boardFilter(board, period);
    const n = binds.length;
    const rows = await db
      .prepare(
        `SELECT p.name AS name FROM (SELECT player_id, MAX(score) AS v FROM runs WHERE ${where} GROUP BY player_id) t JOIN players p ON p.id = t.player_id WHERE t.v > ?${n + 1} AND t.v < ?${n + 2} AND t.player_id != ?${n + 3} ORDER BY t.v DESC LIMIT 3`,
      )
      .bind(...binds, before.best, after.best, me.id)
      .all<{ name: string }>();
    passed = (rows.results ?? []).map((r) => r.name);
  }

  // who is right above now: the rival line of the results screen
  let above: { name: string; value: number } | null = null;
  if (after.rank !== null && after.rank > 1) {
    const { where, binds } = boardFilter(board, period);
    above = await db
      .prepare(
        `SELECT p.name AS name, t.v AS value FROM (SELECT player_id, MAX(score) AS v FROM runs WHERE ${where} GROUP BY player_id) t JOIN players p ON p.id = t.player_id WHERE t.v > ?${binds.length + 1} ORDER BY t.v ASC LIMIT 1`,
      )
      .bind(...binds, after.best)
      .first<{ name: string; value: number }>();
  }
  return json({ accepted: true, ranked: ranked === 1, rank: after.rank, previousRank: before.rank, best: after.best, above, passed, ghostStored }, 201);
}

// ---------------------------------------------------------------------------- boards

async function board(url: URL, boardId: string, db: D1Database): Promise<Response> {
  const period = url.searchParams.get("period") ?? "";
  const metric = (url.searchParams.get("metric") ?? "score") as Metric;
  if (!(metric in METRICS)) return json({ error: "bad_metric" }, 400);
  if (!/^(season|daily|weekly|event:[a-z0-9-]{1,40})$/.test(boardId)) return json({ error: "bad_board" }, 400);
  const limitRaw = Number(url.searchParams.get("limit") ?? 50);
  const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50));
  const agg = METRICS[metric];
  const { where, binds } = boardFilter(boardId, period);
  const rows = await db
    .prepare(
      `SELECT t.player_id AS playerId, p.name AS name, p.crest AS crest, p.title AS title, p.level AS level, t.v AS value
       FROM (SELECT player_id, ${agg} AS v, MIN(created_at) AS at FROM runs WHERE ${where} GROUP BY player_id) t
       JOIN players p ON p.id = t.player_id ORDER BY t.v DESC, t.at ASC LIMIT ${limit}`,
    )
    .bind(...binds)
    .all<{ playerId: string; name: string; crest: string; title: string; level: number; value: number }>();
  const entries = (rows.results ?? []).map((r, i) => ({ rank: i + 1, ...r }));
  const player = url.searchParams.get("player");
  let me: { rank: number; value: number } | null = null;
  if (player) {
    const s = await standing(db, boardId, period, metric, player);
    if (s.rank !== null) me = { rank: s.rank, value: s.best };
  }
  return json({ board: boardId, period, metric, entries, me });
}

/** The group's total for a bounty over its window. */
async function bountyValue(db: D1Database, b: BountyDef): Promise<number> {
  const from = dayStart(seasonStartDay() + b.startDayOffset);
  const to = dayStart(seasonStartDay() + b.startDayOffset + b.days);
  const col = b.stat === "coins" ? "SUM(coins)" : b.stat === "distance" ? "SUM(distance)" : b.stat === "contracts" ? "SUM(contracts)" : "COUNT(*)";
  const row = await db.prepare(`SELECT ${col} AS v FROM runs WHERE created_at >= ?1 AND created_at < ?2`).bind(from, to).first<{ v: number | null }>();
  return Math.floor(row?.v ?? 0);
}

/**
 * Community bounties: the running one (for the progress bar) and every one started this season,
 * finished ones included, so a player who comes back after the window still gets the reward.
 */
async function community(db: D1Database): Promise<Response> {
  const today = dayIndex(Date.now());
  const active = activeBounty(today);
  const bounties = [];
  for (const b of startedBounties(today)) bounties.push({ id: b.id, value: await bountyValue(db, b), goal: b.goal });
  return json({ bounty: bounties.find((b) => b.id === active?.id) ?? null, bounties });
}

/**
 * The ghost to race on a seeded board: a chosen player's (`target`), your own best (`self=1`), or
 * by default the player just above your best (the next target) — your own best when you lead, and
 * before your first run the lowest ghost on the board, the most beatable.
 */
async function ghost(url: URL, boardId: string, db: D1Database): Promise<Response> {
  if (attemptLimit(boardId) <= 0) return json({ error: "bad_board" }, 400);
  const period = url.searchParams.get("period") ?? "";
  const player = url.searchParams.get("player") ?? "";
  const target = url.searchParams.get("target");
  const cols = "g.player_id AS playerId, p.name AS name, g.score AS score, g.data AS data";
  const from = "FROM ghosts g JOIN players p ON p.id = g.player_id WHERE g.board = ?1 AND g.period = ?2";
  type Row = { playerId: string; name: string; score: number; data: string };
  const mine = await db.prepare("SELECT MAX(score) AS v FROM runs WHERE board = ?1 AND period = ?2 AND ranked = 1 AND player_id = ?3").bind(boardId, period, player).first<{ v: number | null }>();
  let row: Row | null;
  if (target || url.searchParams.get("self") === "1") {
    row = await db.prepare(`SELECT ${cols} ${from} AND g.player_id = ?3`).bind(boardId, period, target || player).first<Row>();
  } else if (mine?.v != null) {
    row = await db.prepare(`SELECT ${cols} ${from} AND g.score > ?3 AND g.player_id != ?4 ORDER BY g.score ASC LIMIT 1`).bind(boardId, period, mine.v, player).first<Row>();
    row ??= await db.prepare(`SELECT ${cols} ${from} AND g.player_id = ?3`).bind(boardId, period, player).first<Row>();
  } else {
    row = await db.prepare(`SELECT ${cols} ${from} ORDER BY g.score ASC LIMIT 1`).bind(boardId, period).first<Row>();
  }
  return row ? json(row) : json({ error: "no_ghost" }, 404);
}

/** A player's public card: profile plus season bests and totals from their ranked runs. */
async function playerCard(db: D1Database, id: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: "bad_player" }, 400);
  const p = await db.prepare("SELECT id, name, crest, title, level, house, build, showcase FROM players WHERE id = ?1").bind(id).first<PlayerRow>();
  if (!p) return json({ error: "not_found" }, 404);
  const s = await db
    .prepare(
      "SELECT MAX(score) AS score, MAX(distance) AS distance, MAX(coins) AS coins, MAX(max_combo) AS combo, MAX(clean) AS clean, SUM(contracts) AS contracts, COUNT(*) AS runs FROM runs WHERE season = ?1 AND ranked = 1 AND player_id = ?2",
    )
    .bind(SEASON.id, id)
    .first<Record<string, number | null>>();
  const n = (k: string) => Math.floor(s?.[k] ?? 0);
  const list = (v: string) => (v ? v.split(",") : []);
  return json({
    playerId: p.id,
    name: p.name,
    crest: p.crest,
    title: p.title,
    level: p.level,
    house: p.house,
    build: list(p.build),
    showcase: list(p.showcase),
    season: { score: n("score"), distance: n("distance"), coins: n("coins"), combo: n("combo"), clean: n("clean"), contracts: n("contracts"), runs: n("runs") },
  });
}

/** Weekly house standings: each house's players' best ranked weekly score, top N averaged. */
async function houses(url: URL, db: D1Database): Promise<Response> {
  const period = url.searchParams.get("period") ?? "";
  if (!/^\d{4}-W\d{2}$/.test(period)) return json({ error: "bad_period" }, 400);
  const rows = await db
    .prepare("SELECT house, player_id, MAX(score) AS v FROM runs WHERE board = 'weekly' AND period = ?1 AND ranked = 1 AND house != '' GROUP BY house, player_id")
    .bind(period)
    .all<{ house: string; player_id: string; v: number }>();
  const bests = new Map<string, number[]>(HOUSES.map((h) => [h.id, []]));
  for (const r of rows.results ?? []) bests.get(r.house)?.push(r.v);
  const standings = HOUSES.map((h) => ({ house: h.id, value: houseScore(bests.get(h.id)!), players: bests.get(h.id)!.length })).sort((a, b) => b.value - a.value);
  return json({ period, standings });
}

// ---------------------------------------------------------------------------- router

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
  try {
    if (path === "/api/health") {
      if (method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      return json({ ok: true, db: !!env.DB, version: env.APP_VERSION ?? API_VERSION, time: new Date().toISOString() });
    }
    const known = path === "/api/players" || path === "/api/players/me" || path === "/api/runs" || path === "/api/community" || path === "/api/houses" || path.startsWith("/api/boards/") || path.startsWith("/api/ghosts/") || path.startsWith("/api/players/");
    if (!known) return json({ error: "not_found", path }, 404);
    const db = env.DB;
    if (!db) return dbUnavailable();

    if (path === "/api/players") {
      if (method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
      return await createPlayer(request, db);
    }
    if (path === "/api/community") {
      if (method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      return await community(db);
    }
    if (path === "/api/houses") {
      if (method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      return await houses(url, db);
    }
    if (path.startsWith("/api/players/") && path !== "/api/players/me") {
      if (method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      return await playerCard(db, decodeURIComponent(path.slice("/api/players/".length)));
    }
    if (path.startsWith("/api/ghosts/")) {
      if (method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      return await ghost(url, decodeURIComponent(path.slice("/api/ghosts/".length)), db);
    }
    if (path.startsWith("/api/boards/")) {
      if (method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      return await board(url, decodeURIComponent(path.slice("/api/boards/".length)), db);
    }
    // everything below reads or writes the caller's own data: right method first, then the token
    if (path === "/api/players/me" && method !== "GET" && method !== "PUT") return json({ error: "method_not_allowed" }, 405, { allow: "GET, PUT" });
    if (path === "/api/runs" && method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
    const me = await authPlayer(request, db);
    if (!me) return json({ error: "unauthorized" }, 401);
    if (path === "/api/players/me") {
      if (method === "GET") return json({ playerId: me.id, name: me.name, crest: me.crest, title: me.title, level: me.level });
      return await updatePlayer(request, db, me);
    }
    return await submitRun(request, db, me);
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
