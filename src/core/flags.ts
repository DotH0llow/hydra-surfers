/**
 * Runtime flags derived from build env + query string.
 *
 * - `devtools`: (DEV || VITE_DEVTOOLS==="1") && (DEV || ?dev=1). The build half is the
 *   compile-time constant `__DEVTOOLS_BUILD__` so production bundles drop dev code entirely.
 * - `debug`: window.__game debug API installed (always in dev, else ?debug=1).
 */
import type { ClockMode } from "./loop";

function query(): URLSearchParams {
  try {
    return new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  } catch {
    return new URLSearchParams();
  }
}

const q = query();
const DEV = import.meta.env.DEV === true;
const DEVTOOLS_BUILD = typeof __DEVTOOLS_BUILD__ !== "undefined" ? __DEVTOOLS_BUILD__ : DEV;

function num(name: string): number | undefined {
  const v = q.get(name);
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const flags = {
  dev: DEV,
  devtoolsBuild: DEVTOOLS_BUILD,
  devtools: DEVTOOLS_BUILD && (DEV || q.get("dev") === "1"),
  debug: DEV || q.get("debug") === "1",
  /** Initial clock mode (`?clock=manual` for capture tools). */
  clock: (q.get("clock") === "manual" ? "manual" : "realtime") as ClockMode,
  /** `?seed=123` seed for the first run. */
  seed: num("seed"),
  /** `?scenario=barrier-ahead` scenario for runs started from the home screen. */
  scenario: q.get("scenario") ?? undefined,
  /** `?autostart=1` skips the home screen. */
  autostart: q.get("autostart") === "1",
  /** `?mute=1` */
  mute: q.get("mute") === "1",
} as const;

export type Flags = typeof flags;
