import { describe, expect, it } from "vitest";
import { defaultProfile } from "../../src/core/store";
import { claimBounties } from "../../src/meta/progression";
import { rankNews, rankSnapshot, rivalText } from "../../src/meta/social";
import { BOUNTIES, SEASON, versionAtLeast } from "../../src/shared/content/season";
import type { Board, LeaderboardEntry } from "../../src/online/LeaderboardService";

const board = (names: string[], me: string): Board => {
  const entries: LeaderboardEntry[] = names.map((name, i) => ({ rank: i + 1, playerId: `p_${name}`, name, score: (names.length - i) * 100, isMe: name === me }));
  return { board: "daily", period: "2026-09-19", metric: "score", entries, me: entries.find((e) => e.isMe) ?? null, provider: "http" };
};

describe("meta/social rank news", () => {
  it("names who overtook the player since the last visit", () => {
    const before = rankSnapshot(board(["Ana", "Eu", "Bia", "Caio"], "Eu"))!;
    expect(before).toEqual({ rank: 2, below: ["p_Bia", "p_Caio"] });
    expect(rankNews("no Diário", board(["Ana", "Bia", "Eu", "Caio"], "Eu"), before)).toBe("Bia passou você no Diário. Agora você é #3.");
    expect(rankNews("no Diário", board(["Caio", "Ana", "Bia", "Eu"], "Eu"), before)).toBe("Caio e Bia passaram você no Diário. Agora você é #4.");
  });

  it("reports a plain drop, and stays quiet when nothing got worse", () => {
    const before = rankSnapshot(board(["Ana", "Eu"], "Eu"))!;
    // a newcomer above: not someone who was below, so it is a drop
    expect(rankNews("na temporada", board(["Ana", "Nova", "Eu"], "Eu"), before)).toBe("Você caiu de #2 para #3 na temporada.");
    expect(rankNews("na temporada", board(["Eu", "Ana"], "Eu"), before)).toBeNull();
    expect(rankNews("na temporada", board(["Ana", "Eu"], "Eu"), undefined)).toBeNull();
  });

  it("writes the rival line", () => {
    expect(rivalText("no Diário", board(["Eu", "Ana"], "Eu"))).toContain("Você lidera");
    expect(rivalText("no Diário", board(["Ana", "Eu"], "Eu"))).toBe("#2 no Diário · 100 pontos atrás de Ana");
  });
});

describe("meta/progression community bounties", () => {
  it("grants a completed bounty's reward once, to everyone, and never an unfinished one", () => {
    const p = defaultProfile();
    const [done, open] = BOUNTIES;
    const states = [
      { id: done.id, value: done.goal, goal: done.goal },
      { id: open.id, value: open.goal - 1, goal: open.goal },
    ];
    expect(claimBounties(p, states).map((b) => b.id)).toEqual([done.id]);
    expect(p.progress.claimedBounties).toEqual([done.id]);
    expect(p.owned.crestParts).toContain("crest.frame.gold");
    expect(claimBounties(p, states)).toEqual([]);
    expect(p.progress.seasonId).toBe(SEASON.id);
  });
});

describe("shared/season client versions", () => {
  it("accepts anything when no minimum is set, and compares dotted versions otherwise", () => {
    expect(versionAtLeast("0.0.1", "")).toBe(true);
    expect(versionAtLeast("0.2.0", "0.1.9")).toBe(true);
    expect(versionAtLeast("0.1.9", "0.2.0")).toBe(false);
    expect(versionAtLeast("1.0", "1.0.0")).toBe(true);
    expect(versionAtLeast("0.10.0", "0.9.0")).toBe(true);
    // a client that sends nothing counts as older than any minimum
    expect(versionAtLeast("", "0.1.0")).toBe(false);
  });
});
