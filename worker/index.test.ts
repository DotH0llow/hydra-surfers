/**
 * Worker routes against a real SQLite database: a small D1 adapter over node:sqlite runs
 * worker/schema.sql and every query the Worker issues, so SQL mistakes fail here, not in prod.
 */
import { beforeEach, describe, expect, it } from "vitest";
import worker, { attemptLimit, handleApi, type Env } from "./index";
import { dayKey, seedFor, weekKey } from "../src/shared/calendar";
import { DAILY_ATTEMPTS } from "../src/shared/content/season";
import { GHOST_HZ, decodeGhost, encodeGhost } from "../src/shared/ghost";

interface SqliteStatement {
  all(params?: Record<string, unknown>): unknown[];
  get(params?: Record<string, unknown>): unknown;
  run(params?: Record<string, unknown>): { changes: number; lastInsertRowid: number };
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

// Loaded dynamically so the Worker's type program never needs Node's types.
const SQLITE = "node:sqlite";
const FS = "node:fs";
const { DatabaseSync } = (await import(/* @vite-ignore */ SQLITE)) as { DatabaseSync: new (path: string) => SqliteDb };
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync(path: URL, enc: string): string };
const SCHEMA = readFileSync(new URL("./schema.sql", (import.meta as unknown as { url: string }).url), "utf8");

/** D1 binds `?1, ?2 …` positionally; node:sqlite takes numbered params as an object. */
function d1(db: SqliteDb): D1Database {
  const prepare = (sql: string) => {
    let params: Record<string, unknown> = {};
    const stmt = {
      bind(...args: unknown[]) {
        params = {};
        args.forEach((v, i) => (params[String(i + 1)] = v));
        return stmt;
      },
      async all() {
        return { results: db.prepare(sql).all(params), success: true };
      },
      async first() {
        return (db.prepare(sql).get(params) as unknown) ?? null;
      },
      async run() {
        const r = db.prepare(sql).run(params);
        return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

let env: Env;
const NOW = Date.now();
const today = dayKey(NOW);

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  env = { DB: d1(db) };
});

const call = (path: string, init?: RequestInit, e: Env = env) => handleApi(new Request(`https://hydra.test${path}`, init), e);
const post = (path: string, body: unknown, token?: string, method = "POST") =>
  call(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

async function register(name: string): Promise<{ playerId: string; token: string }> {
  const res = await post("/api/players", { name });
  expect(res.status).toBe(201);
  return (await res.json()) as { playerId: string; token: string };
}

const run = (over: Record<string, unknown> = {}) => ({
  board: "season",
  period: "",
  seed: 42,
  score: 5000,
  distance: 1200,
  coins: 150,
  duration: 90,
  maxCombo: 12,
  cleanDistance: 400,
  ...over,
});

describe("worker /api", () => {
  it("health reports the db binding; data routes answer 503 without one", async () => {
    expect(await (await call("/api/health", undefined, {})).json()).toMatchObject({ ok: true, db: false });
    const res = await call("/api/boards/season", undefined, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "db_unavailable", fallback: "mock" });
  });

  it("registers unique names (case and accents folded) and rejects bad ones", async () => {
    const a = await register("Ana");
    expect(a.token).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    expect((await post("/api/players", { name: "ANA" })).status).toBe(409);
    expect((await post("/api/players", { name: "Âna" })).status).toBe(409);
    expect((await post("/api/players", { name: "x" })).status).toBe(422);
    expect((await post("/api/players", { name: "<script>" })).status).toBe(422);
  });

  it("requires the bearer token for writes and restores the account from it", async () => {
    expect((await post("/api/runs", run())).status).toBe(401);
    expect((await post("/api/runs", run(), "WRONG-TOKEN-XXXXX")).status).toBe(401);
    const { playerId, token } = await register("Bruno");
    const me = await call("/api/players/me", { headers: { authorization: `Bearer ${token.toLowerCase()}` } });
    expect(await me.json()).toMatchObject({ playerId, name: "Bruno" });
  });

  it("ranks runs on the season board by best score, with me and the player above", async () => {
    const a = await register("Arthur");
    const b = await register("Marina");
    await post("/api/runs", run({ score: 9000 }), a.token);
    const res = await post("/api/runs", run({ score: 4000 }), b.token);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ accepted: true, ranked: true, rank: 2, previousRank: null, best: 4000, above: { name: "Arthur", value: 9000 } });
    const better = (await (await post("/api/runs", run({ score: 9500 }), b.token)).json()) as { rank: number; previousRank: number };
    expect(better).toMatchObject({ rank: 1, previousRank: 2 });

    const board = (await (await call(`/api/boards/season?player=${a.playerId}`)).json()) as { entries: Array<{ name: string; value: number }>; me: { rank: number } };
    expect(board.entries.map((e) => [e.name, e.value])).toEqual([
      ["Marina", 9500],
      ["Arthur", 9000],
    ]);
    expect(board.me).toEqual({ rank: 2, value: 9000 });
  });

  it("ranks record boards by other metrics", async () => {
    const a = await register("Caio");
    const b = await register("Duda");
    await post("/api/runs", run({ distance: 3000, duration: 200, score: 1000 }), a.token);
    await post("/api/runs", run({ distance: 1500, score: 8000 }), b.token);
    const byDistance = (await (await call("/api/boards/season?metric=distance")).json()) as { entries: Array<{ name: string }> };
    expect(byDistance.entries[0].name).toBe("Caio");
    expect((await call("/api/boards/season?metric=bogus")).status).toBe(400);
  });

  it("only accepts the daily seed on the daily board, and caps ranked attempts", async () => {
    const { token } = await register("Enzo");
    const daily = { board: "daily", period: today, seed: seedFor("daily", today) };
    const wrongSeed = await post("/api/runs", run({ ...daily, seed: 7 }), token);
    expect(wrongSeed.status).toBe(422);
    expect(((await wrongSeed.json()) as { errors: string[] }).errors.join()).toContain("seed");

    for (let i = 0; i < DAILY_ATTEMPTS; i++) {
      expect(((await (await post("/api/runs", run({ ...daily, score: 100 + i }), token)).json()) as { ranked: boolean }).ranked).toBe(true);
    }
    const extra = (await (await post("/api/runs", run({ ...daily, score: 99999 }), token)).json()) as { ranked: boolean; best: number };
    expect(extra.ranked).toBe(false);
    // the practice run did not change the ranked best
    expect(extra.best).toBe(100 + DAILY_ATTEMPTS - 1);
    expect(attemptLimit("daily")).toBe(DAILY_ATTEMPTS);
  });

  it("ranks houses by the mean of their five best weekly players, ignoring headcount", async () => {
    const week = weekKey(NOW);
    const weekly = { board: "weekly", period: week, seed: seedFor("weekly", week) };
    // the lion has six players (only the best five count), the raven one star
    for (let i = 0; i < 6; i++) {
      const { token } = await register(`Leao ${i}`);
      await post("/api/runs", run({ ...weekly, score: 1000 + i * 100, house: "leao" }), token);
    }
    const star = await register("Estrela");
    await post("/api/runs", run({ ...weekly, score: 4000, house: "corvo" }), star.token);
    await post("/api/runs", run({ ...weekly, score: 3000, house: "corvo" }), star.token);
    // an unknown house is stored as none
    const other = await register("Sem Casa");
    await post("/api/runs", run({ ...weekly, score: 9000, house: "dragao" }), other.token);

    const body = (await (await call(`/api/houses?period=${week}`)).json()) as { standings: Array<{ house: string; value: number; players: number }> };
    expect(body.standings.map((s) => s.house)).toEqual(["leao", "corvo", "cervo", "serpente"]);
    expect(body.standings[0]).toEqual({ house: "leao", value: (1500 + 1400 + 1300 + 1200 + 1100) / 5, players: 6 });
    expect(body.standings[1]).toEqual({ house: "corvo", value: 4000 / 5, players: 1 });
    expect((await call("/api/houses?period=nope")).status).toBe(400);
  });

  it("keeps each player's best daily ghost and serves the one just above you", async () => {
    const daily = { board: "daily", period: today, seed: seedFor("daily", today) };
    const track = (distance: number, duration: number) => {
      const n = duration * GHOST_HZ + 1;
      const d = Array.from({ length: n }, (_, i) => (distance * i) / (n - 1));
      return encodeGhost(d, new Array(n).fill(0), new Array(n).fill(0), n);
    };
    const dailyRun = (score: number, distance: number, duration: number, ghost = track(distance, duration)) =>
      run({ ...daily, score, distance, duration, coins: 10, ghost });

    const low = await register("Lento");
    const mid = await register("Medio");
    const top = await register("Rapido");
    const me = await register("Eu Mesmo");
    const stored = async (token: string, body: Record<string, unknown>) => ((await (await post("/api/runs", body, token)).json()) as { ghostStored: boolean }).ghostStored;
    expect(await stored(low.token, dailyRun(1000, 400, 40))).toBe(true);
    expect(await stored(mid.token, dailyRun(2000, 600, 50))).toBe(true);
    expect(await stored(top.token, dailyRun(3000, 800, 60))).toBe(true);
    // a worse run does not replace the best ghost, and a track that does not fit its run is refused
    expect(await stored(mid.token, dailyRun(1500, 500, 45))).toBe(false);
    expect(await stored(top.token, dailyRun(3500, 900, 70, track(400, 20)))).toBe(false);

    const ghostFor = async (playerId: string) => {
      const res = await call(`/api/ghosts/daily?period=${today}&player=${playerId}`);
      return res.status === 200 ? ((await res.json()) as { name: string; score: number; data: string }) : null;
    };
    // before any run: the most beatable ghost on the board
    expect((await ghostFor(me.playerId))?.name).toBe("Lento");
    await post("/api/runs", dailyRun(1200, 450, 42), me.token);
    // then the next one above
    expect((await ghostFor(me.playerId))?.name).toBe("Medio");
    // the leader races their own best, and the data is a real track
    const own = await ghostFor(top.playerId);
    expect(own?.name).toBe("Rapido");
    expect(decodeGhost(own!.data)?.count).toBe(60 * GHOST_HZ + 1);
    expect((await call(`/api/ghosts/daily?period=2020-01-01&player=${me.playerId}`)).status).toBe(404);
    expect((await call(`/api/ghosts/weekly?period=${today}`)).status).toBe(400);
  });

  it("rejects implausible runs and stale periods", async () => {
    const { token } = await register("Fabi");
    expect((await post("/api/runs", run({ distance: 40000, duration: 60 }), token)).status).toBe(422);
    expect((await post("/api/runs", run({ score: 999_999_999 }), token)).status).toBe(422);
    expect((await post("/api/runs", run({ board: "daily", period: "2020-01-01", seed: seedFor("daily", "2020-01-01") }), token)).status).toBe(422);
    const week = weekKey(NOW);
    expect((await post("/api/runs", run({ board: "weekly", period: week, seed: seedFor("weekly", week) }), token)).status).toBe(201);
  });

  it("renames, refusing a name that belongs to someone else", async () => {
    await register("Gabi");
    const { token } = await register("Heitor");
    expect((await post("/api/players/me", { name: "gabi" }, token, "PUT")).status).toBe(409);
    const ok = await post("/api/players/me", { name: "Heitor II", crest: "2.5.0.3", title: "title.campeao", level: 7 }, token, "PUT");
    expect(await ok.json()).toMatchObject({ name: "Heitor II", crest: "2.5.0.3", title: "title.campeao", level: 7 });
  });

  it("rejects wrong methods and unknown routes with JSON", async () => {
    expect((await call("/api/runs")).status).toBe(405);
    expect((await call("/api/nope")).status).toBe(404);
    expect((await call("/api/boards/hack'--")).status).toBe(400);
  });

  it("default export routes non-API paths to the assets binding", async () => {
    const e: Env = { ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher };
    expect(await (await worker.fetch(new Request("https://hydra.test/index.html"), e)).text()).toBe("asset");
    expect((await worker.fetch(new Request("https://hydra.test/api/health"), e)).status).toBe(200);
  });
});
