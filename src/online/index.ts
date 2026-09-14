/**
 * Provider selection: `VITE_ONLINE_PROVIDER=mock` (default) or `http` (the Worker in worker/).
 * The http provider falls back to the mock league whenever the API answers 503 (no D1 bound) or
 * is unreachable, so the leaderboard UI always has data.
 */
import type { StorageLike } from "../core/store";
import type { LeaderboardService } from "./LeaderboardService";
import { HttpProvider, type Identity } from "./HttpProvider";
import { MockProvider } from "./MockProvider";

export * from "./LeaderboardService";
export { MockProvider } from "./MockProvider";
export { HttpProvider, type Identity } from "./HttpProvider";

const ID_KEY = "yard-dash.player";

export function getIdentity(storage: StorageLike | null): Identity {
  try {
    const raw = storage?.getItem(ID_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Identity;
      if (v.playerId && v.playerName) return v;
    }
  } catch {
    /* fresh identity */
  }
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.floor(Math.random() * 2 ** 48).toString(36);
  const id: Identity = { playerId: `p_${rand}`, playerName: `Runner${rand.slice(0, 4).toUpperCase()}` };
  try {
    storage?.setItem(ID_KEY, JSON.stringify(id));
  } catch {
    /* ignore */
  }
  return id;
}

export function createLeaderboardService(storage: StorageLike | null, provider = import.meta.env.VITE_ONLINE_PROVIDER ?? "mock"): LeaderboardService {
  const identity = getIdentity(storage);
  const mock = new MockProvider({ ...identity, storage, seed: 1 });
  return provider === "http" ? new HttpProvider(identity, mock) : mock;
}
