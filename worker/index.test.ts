import { describe, expect, it } from "vitest";
import worker, { handleApi, validateScore, weekKey, type Env } from "./index";

const call = (path: string, init?: RequestInit, env: Env = {}) => handleApi(new Request(`https://yard.test${path}`, init), env);

/** Minimal in-memory D1 stand-in: records statements, returns canned rows. */
function fakeDb(rows: Array<Record<string, unknown>> = []) {
  const log: Array<{ sql: string; binds: unknown[]; op: string }> = [];
  const stmt = (sql: string) => {
    let binds: unknown[] = [];
    const s = {
      bind: (...b: unknown[]) => {
        binds = b;
        return s;
      },
      all: async () => (log.push({ sql, binds, op: "all" }), { results: rows }),
      first: async () => (log.push({ sql, binds, op: "first" }), sql.includes("COUNT") ? { n: 2 } : { score: 500 }),
      run: async () => (log.push({ sql, binds, op: "run" }), { success: true }),
    };
    return s;
  };
  return { db: { prepare: stmt } as unknown as D1Database, log };
}

describe("worker /api", () => {
  it("health reports db binding", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: false });
    const { db } = fakeDb();
    expect(await (await call("/api/health", undefined, { DB: db })).json()).toMatchObject({ db: true });
  });

  it("returns 503 JSON for leaderboard and scores without a D1 binding", async () => {
    for (const [path, init] of [
      ["/api/leaderboard?scope=global", undefined],
      ["/api/scores", { method: "POST", body: JSON.stringify({ playerId: "abcdef", name: "A", score: 1 }) }],
    ] as const) {
      const res = await call(path, init);
      expect(res.status).toBe(503);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toMatchObject({ error: "db_unavailable", fallback: "mock" });
    }
  });

  it("rejects wrong methods and unknown routes with JSON", async () => {
    expect((await call("/api/scores")).status).toBe(405);
    expect((await call("/api/leaderboard", { method: "POST" })).status).toBe(405);
    const nf = await call("/api/nope");
    expect(nf.status).toBe(404);
    expect(await nf.json()).toMatchObject({ error: "not_found" });
  });

  it("validates score submissions", () => {
    expect(validateScore({ playerId: "player_01", name: "Ana", score: 1234.9, coins: 5, distance: 88.5, seed: 7 })).toEqual({
      ok: true,
      value: { playerId: "player_01", name: "Ana", score: 1234, coins: 5, distance: 88.5, seed: 7 },
    });
    const bad = validateScore({ playerId: "x", name: "", score: -1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.length).toBe(3);
    expect(validateScore([]).ok).toBe(false);
    expect(validateScore({ playerId: "abcdef", name: "Name With Spaces", score: 1 }).ok).toBe(true);
  });

  it("serves leaderboard and inserts scores when D1 is bound", async () => {
    const { db, log } = fakeDb([{ playerId: "p1", name: "A", score: 900, distance: 10, at: 1 }]);
    const lb = await call("/api/leaderboard?scope=weekly&limit=5&player=p1", undefined, { DB: db });
    expect(lb.status).toBe(200);
    const body = (await lb.json()) as { entries: Array<{ rank: number }>; me: { rank: number }; week: string };
    expect(body.entries[0].rank).toBe(1);
    expect(body.me).toEqual({ rank: 3, score: 500 });
    expect(body.week).toMatch(/^\d{4}-W\d{2}$/);
    expect((await call("/api/leaderboard?scope=bogus", undefined, { DB: db })).status).toBe(400);

    const post = await call("/api/scores", { method: "POST", body: JSON.stringify({ playerId: "p1_abc", name: "A", score: 42 }) }, { DB: db });
    expect(post.status).toBe(201);
    expect(await post.json()).toEqual({ ok: true, rank: 3 });
    expect(log.some((l) => l.op === "run" && l.sql.startsWith("INSERT INTO scores"))).toBe(true);
    expect((await call("/api/scores", { method: "POST", body: "{nope" }, { DB: db })).status).toBe(400);
  });

  it("default export routes non-API paths to the assets binding", async () => {
    const env: Env = { ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher };
    const res = await worker.fetch(new Request("https://yard.test/index.html"), env);
    expect(await res.text()).toBe("asset");
    const api = await worker.fetch(new Request("https://yard.test/api/health"), env);
    expect(api.status).toBe(200);
  });

  it("computes ISO week keys", () => {
    expect(weekKey(Date.UTC(2026, 0, 1))).toBe("2026-W01"); // Thu
    expect(weekKey(Date.UTC(2027, 0, 1))).toBe("2026-W53"); // Fri belongs to last week of 2026
    expect(weekKey(Date.UTC(2026, 8, 13))).toBe("2026-W37");
  });
});
