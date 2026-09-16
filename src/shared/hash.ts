/**
 * String hashing shared by the client and worker/ (no DOM, no browser APIs).
 *
 * Seeds for a period ("2026-09-15", "2026-W38", "event:cerco") must be identical on both sides:
 * the client generates the track from them and the worker validates that a submitted run used the
 * seed it was supposed to use. Keep this file free of imports that pull in browser code.
 */
import { hash32 } from "../core/rng";

/** FNV-1a over UTF-16 code units, finished with a bit-mixer so similar strings diverge. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return hash32(h);
}

export { hash32 };
