import { describe, expect, it } from "vitest";
import { HttpProvider, MockProvider, createLeaderboardService, getIdentity, nextWeeklyReset } from "../../src/online";
import type { StorageLike } from "../../src/core/store";

const mem = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
const NOW = Date.UTC(2026, 8, 13, 12); // Sunday
const mk = (storage = mem(), seed = 1) =>
  new MockProvider({ seed, storage, playerId: "p_me_123", playerName: "Me", latencyMs: [0, 0], now: () => NOW });

describe("online: MockProvider", () => {
  it("builds the same fake league for the same seed", async () => {
    expect(mk().league("global")).toEqual(mk().league("global"));
    expect(mk(mem(), 2).league("global")).not.toEqual(mk().league("global"));
    const b = await mk().getBoard("global");
    expect(b.entries).toHaveLength(50);
    expect(b.me).toBeNull();
    expect(b.provider).toBe("mock");
    for (let i = 1; i < b.entries.length; i++) expect(b.entries[i - 1].score).toBeGreaterThanOrEqual(b.entries[i].score);
  });

  it("ranks and persists the local player's best score", async () => {
    const storage = mem();
    const p = mk(storage);
    const r1 = await p.submitScore({ score: 5000, coins: 10, distance: 400 });
    const r2 = await p.submitScore({ score: 100, coins: 1, distance: 20 });
    expect(r2.best).toBe(5000);
    expect(r1.rank).toBe(r2.rank);
    const board = await mk(storage).getBoard("global", "p_me_123");
    expect(board.me).toMatchObject({ isMe: true, score: 5000, rank: r1.rank });
    expect(board.entries.some((e) => e.isMe)).toBe(true);
    expect((await mk(storage).getProfile()).bestScore).toBe(5000);
  });

  it("weekly boards expose the next Monday reset; friends is a small board", async () => {
    const w = await mk().getBoard("weekly");
    expect(w.resetsAt).toBe(nextWeeklyReset(NOW));
    expect(new Date(w.resetsAt!).getUTCDay()).toBe(1);
    expect(w.resetsAt! - NOW).toBeLessThanOrEqual(7 * 86_400_000);
    expect((await mk().getBoard("friends")).entries.length).toBe(12);
  });
});

describe("online: provider selection + http fallback", () => {
  it("defaults to mock and creates a stable identity", () => {
    const storage = mem();
    expect(createLeaderboardService(storage, "mock").id).toBe("mock");
    expect(createLeaderboardService(storage, "http").id).toBe("http");
    expect(getIdentity(storage)).toEqual(getIdentity(storage));
  });

  it("falls back to the mock board when the API returns 503", async () => {
    const calls: string[] = [];
    const fetch503 = (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ error: "db_unavailable" }), { status: 503 });
    }) as unknown as typeof fetch;
    const http = new HttpProvider({ playerId: "p_me_123", playerName: "Me" }, mk(), "", fetch503);
    const b = await http.getBoard("global");
    expect(b.provider).toBe("mock");
    expect(calls[0]).toContain("/api/leaderboard?scope=global");
    const s = await http.submitScore({ score: 10, coins: 0, distance: 1 });
    expect(s.provider).toBe("mock");
  });

  it("uses API data when available", async () => {
    const ok = (async (url: string) =>
      String(url).includes("leaderboard")
        ? new Response(JSON.stringify({ entries: [{ rank: 1, playerId: "p_me_123", name: "Me", score: 9 }], me: { rank: 1, score: 9 } }))
        : new Response(JSON.stringify({ ok: true, rank: 4 }), { status: 201 })) as unknown as typeof fetch;
    const http = new HttpProvider({ playerId: "p_me_123", playerName: "Me" }, mk(), "", ok);
    const b = await http.getBoard("weekly");
    expect(b.provider).toBe("http");
    expect(b.entries[0].isMe).toBe(true);
    expect((await http.submitScore({ score: 9, coins: 0, distance: 1 })).rank).toBe(4);
  });
});
