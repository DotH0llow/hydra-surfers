import { describe, expect, it } from "vitest";
import { HttpProvider, MockProvider, createLeaderboardService, getIdentity, type Identity } from "../../src/online";
import type { StorageLike } from "../../src/core/store";

const mem = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
const ME: Identity = { playerId: "local_me", playerName: "Eu" };
const mk = (storage = mem(), seed = 1) => new MockProvider({ seed, storage, identity: ME, latencyMs: [0, 0] });

describe("online: MockProvider (offline league)", () => {
  it("builds the same group-sized league for the same board, and a different one per period", () => {
    expect(mk().league("season", "", "score")).toEqual(mk().league("season", "", "score"));
    expect(mk().league("daily", "2026-09-15", "score")).not.toEqual(mk().league("daily", "2026-09-16", "score"));
    expect(mk().league("season", "", "score").length).toBeLessThanOrEqual(40);
  });

  it("ranks and persists the player's best per board, reporting rank movement and the rival above", async () => {
    const storage = mem();
    const p = mk(storage);
    const first = await p.submitScore({ score: 3000, coins: 10, distance: 400, board: "daily", period: "2026-09-15" });
    expect(first.previousRank).toBeNull();
    expect(first.rank).not.toBeNull();
    const better = await p.submitScore({ score: 30000, coins: 10, distance: 900, board: "daily", period: "2026-09-15" });
    expect(better.previousRank).toBe(first.rank);
    expect(better.rank!).toBeLessThanOrEqual(first.rank!);
    if (better.above) expect(better.above.value).toBeGreaterThan(30000);

    const board = await mk(storage).getBoard("daily", "2026-09-15");
    expect(board.me).toMatchObject({ isMe: true, score: 30000 });
    // other boards are untouched
    expect((await mk(storage).getBoard("season")).me).toBeNull();
  });

  it("does not rank practice runs", async () => {
    const p = mk();
    const r = await p.submitScore({ score: 9000, coins: 0, distance: 100, board: "daily", period: "d", ranked: false });
    expect(r.ranked).toBe(false);
    expect((await p.getBoard("daily", "d")).me).toBeNull();
  });

  it("renames with the same rules as the server", async () => {
    const p = mk();
    expect(await p.rename("x")).toEqual({ ok: false, error: "invalid" });
    expect(await p.rename("  Lady   Ana ")).toEqual({ ok: true });
    expect(p.identity().playerName).toBe("Lady Ana");
  });
});

describe("online: identity + http provider", () => {
  it("creates one stable local identity", () => {
    const storage = mem();
    expect(getIdentity(storage)).toEqual(getIdentity(storage));
    expect(createLeaderboardService(storage, "mock").id).toBe("mock");
    expect(createLeaderboardService(storage, "http").id).toBe("http");
  });

  it("falls back to the offline league when the API answers 503", async () => {
    const fetch503 = (async () => new Response(JSON.stringify({ error: "db_unavailable" }), { status: 503 })) as unknown as typeof fetch;
    const http = new HttpProvider(ME, mk(), () => {}, "", fetch503);
    expect((await http.getBoard("season")).provider).toBe("mock");
    expect((await http.submitScore({ score: 10, coins: 0, distance: 1 })).provider).toBe("mock");
  });

  it("registers lazily on the first run, then signs every write with the token", async () => {
    const calls: Array<{ url: string; auth: string | null; body: unknown }> = [];
    const saved: Identity[] = [];
    const api = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).endsWith("/api/players")) return new Response(JSON.stringify({ playerId: "p_server", token: "AAAAA-BBBBB-CCCCC", name: "Eu" }), { status: 201 });
      if (String(url).endsWith("/api/runs")) return new Response(JSON.stringify({ accepted: true, ranked: true, rank: 3, previousRank: 5, best: 900, above: { name: "Arthur", value: 1200 } }), { status: 201 });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const http = new HttpProvider(ME, mk(), (id) => saved.push(id), "", api);
    const res = await http.submitScore({ score: 900, coins: 5, distance: 300, board: "daily", period: "2026-09-15", seed: 7, duration: 40 });
    expect(res).toMatchObject({ provider: "http", rank: 3, previousRank: 5, above: { name: "Arthur" } });
    expect(calls[0].url).toContain("/api/players");
    expect(calls[1].auth).toBe("Bearer AAAAA-BBBBB-CCCCC");
    expect(calls[1].body).toMatchObject({ board: "daily", period: "2026-09-15", seed: 7, duration: 40 });
    expect(saved[0]).toEqual({ playerId: "p_server", playerName: "Eu", token: "AAAAA-BBBBB-CCCCC" });
    expect(http.identity().token).toBe("AAAAA-BBBBB-CCCCC");
  });

  it("maps server board rows onto entries and marks the player", async () => {
    const api = (async () =>
      new Response(JSON.stringify({ entries: [{ rank: 1, playerId: "local_me", name: "Eu", value: 77, crest: "1.2.0.3", title: "title.rei" }], me: { rank: 1, value: 77 } }))) as unknown as typeof fetch;
    const http = new HttpProvider(ME, mk(), () => {}, "", api);
    const b = await http.getBoard("weekly", "2026-W38");
    expect(b).toMatchObject({ provider: "http", me: { rank: 1, score: 77 } });
    expect(b.entries[0]).toMatchObject({ isMe: true, score: 77, crest: "1.2.0.3", title: "title.rei" });
  });
});
