/**
 * Provider selection: `VITE_ONLINE_PROVIDER=http` (default, the Worker in worker/) or `mock` (offline only).
 * The http provider falls back to the offline league whenever the API answers 503 (no D1 bound) or
 * is unreachable, so the UI always has data.
 *
 * The identity (player id, display name and, once registered, the server token) lives in its own
 * storage key, separate from the profile, so resetting progress never loses the account.
 */
import type { StorageLike } from "../core/store";
import type { Identity, LeaderboardService } from "./LeaderboardService";
import { HttpProvider } from "./HttpProvider";
import { MockProvider } from "./MockProvider";

export * from "./LeaderboardService";
export { MockProvider } from "./MockProvider";
export { HttpProvider } from "./HttpProvider";

const ID_KEY = "hydra-surfers.player";

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
  const id: Identity = { playerId: `local_${rand}`, playerName: `Viajante ${rand.slice(0, 4).toUpperCase()}` };
  saveIdentity(storage, id);
  return id;
}

export function saveIdentity(storage: StorageLike | null, id: Identity): void {
  try {
    storage?.setItem(ID_KEY, JSON.stringify(id));
  } catch {
    /* ignore */
  }
}

export function createLeaderboardService(storage: StorageLike | null, provider = import.meta.env.VITE_ONLINE_PROVIDER ?? "http"): LeaderboardService {
  const identity = getIdentity(storage);
  const save = (id: Identity) => saveIdentity(storage, id);
  const mock = new MockProvider({ identity, storage, seed: 1, onIdentity: (id) => save({ ...getIdentity(storage), playerName: id.playerName }) });
  return provider === "http" ? new HttpProvider(identity, mock, save) : mock;
}
