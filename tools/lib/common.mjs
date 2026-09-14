// Shared helpers for tools/*.mjs (no dependencies beyond node + playwright-core).
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Minimal argv parser: `--key value`, `--key=value`, bare `--flag` → true, positional → `_`.
 * A following token that starts with `--` is not consumed as a value.
 */
export function parseArgs(argv = process.argv.slice(2), booleans = []) {
  const out = { _: [] };
  const bools = new Set(booleans);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) {
      out[camel(a.slice(2, eq))] = a.slice(eq + 1);
      continue;
    }
    const key = camel(a.slice(2));
    const next = argv[i + 1];
    if (bools.has(key) || next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function camel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function num(v, fallback) {
  if (v === undefined || v === null || v === true || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** "540x960" → {width: 540, height: 960} */
export function parseViewport(v, fallback = { width: 540, height: 960 }) {
  if (!v) return fallback;
  if (typeof v === "object") return { width: Number(v.width), height: Number(v.height) };
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(v).trim());
  if (!m) throw new Error(`bad viewport "${v}" (expected WIDTHxHEIGHT, e.g. 540x960)`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
  return p;
}

/** Newest mtime (ms) of any file under the given paths (files or directories). */
export function newestMtime(paths) {
  let newest = 0;
  const visit = (p) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        visit(join(p, name));
      }
    } else if (st.mtimeMs > newest) newest = st.mtimeMs;
  };
  for (const p of paths) visit(p);
  return newest;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pad(n, width = 4) {
  return String(n).padStart(width, "0");
}

export function log(...a) {
  console.log("[tools]", ...a);
}
