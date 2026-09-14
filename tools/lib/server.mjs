// Build-if-stale + `vite preview` lifecycle for capture tools.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, log, newestMtime, sleep } from "./common.mjs";

const VITE = join(ROOT, "node_modules", "vite", "bin", "vite.js");
const BUILD_INPUTS = ["src", "public", "index.html", "vite.config.ts", "package.json", "tsconfig.json"].map((p) => join(ROOT, p));
const STAMP = ".yd-build.json";

/**
 * Builds into `outDir` when it is missing, older than any source input, or was built with a
 * different devtools setting. Returns {built, outDir, reason}.
 */
export function ensureBuild({ outDir = join(ROOT, "dist"), devtools = false, force = false } = {}) {
  const index = join(outDir, "index.html");
  const stampPath = join(outDir, STAMP);
  let reason = "";
  if (force) reason = "--rebuild";
  else if (!existsSync(index)) reason = "no build output";
  else {
    const builtAt = statSync(index).mtimeMs;
    const newest = newestMtime(BUILD_INPUTS);
    if (newest > builtAt) reason = "sources newer than build";
    else {
      let stamp = null;
      try {
        stamp = JSON.parse(readFileSync(stampPath, "utf8"));
      } catch {
        /* no stamp: a plain `npm run build` (devtools off) */
      }
      const builtDevtools = stamp ? !!stamp.devtools : false;
      if (builtDevtools !== devtools) reason = `devtools ${builtDevtools ? "on" : "off"} in existing build`;
    }
  }
  if (!reason) return { built: false, outDir, reason: "up to date" };
  log(`building ${relative(ROOT, outDir) || "."} (${reason}; VITE_DEVTOOLS=${devtools ? "1" : "unset"})`);
  const env = { ...process.env };
  delete env.VITE_DEVTOOLS;
  if (devtools) env.VITE_DEVTOOLS = "1";
  const r = spawnSync(process.execPath, [VITE, "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error("vite build failed");
  // The stamp lives in the build output but is not a web asset anyone links to. Only written for
  // devtools builds so a plain production dist/ stays byte-identical to `npm run build`.
  if (devtools) writeFileSync(stampPath, JSON.stringify({ devtools, builtAt: Date.now() }));
  return { built: true, outDir, reason };
}

async function probe(url, timeoutMs = 1500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    const text = await res.text();
    return { ok: res.ok, text };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const isOurApp = (html) => html.includes('id="playfield"') && html.includes('id="scene"');

/**
 * Reuses a preview server already answering on `port` (if it serves this app), otherwise starts
 * `vite preview --outDir <outDir> --port <port> --strictPort`. Returns {url, stop(), reused}.
 * A reused server serves whatever directory it was started with; for dist/ that is the build we
 * just refreshed on disk.
 */
export async function ensurePreview({ port = 5100, outDir = join(ROOT, "dist"), reuse = true } = {}) {
  const url = `http://localhost:${port}/`;
  const existing = await probe(url);
  if (existing) {
    if (!isOurApp(existing.text)) throw new Error(`port ${port} is serving something that is not this app; pass --port`);
    if (reuse) {
      log(`reusing server on ${url}`);
      return { url, reused: true, stop: async () => {} };
    }
    throw new Error(`port ${port} already in use`);
  }
  const child = spawn(process.execPath, [VITE, "preview", "--outDir", outDir, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const started = Date.now();
  const localUrl = `http://127.0.0.1:${port}/`;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`vite preview exited (${child.exitCode}):\n${output}`);
    const r = await probe(localUrl, 800);
    if (r && isOurApp(r.text)) break;
    if (Date.now() - started > 30_000) {
      child.kill();
      throw new Error(`vite preview did not come up on ${localUrl} within 30 s:\n${output}`);
    }
    await sleep(150);
  }
  log(`started vite preview on ${localUrl} (${relative(ROOT, outDir) || "."})`);
  return {
    url: localUrl,
    reused: false,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill();
        await Promise.race([new Promise((r) => child.once("exit", r)), sleep(2000)]);
      }
    },
  };
}
