#!/usr/bin/env node
// Scenario capture (PLAN.md §5).
//
//   node tools/capture.mjs --scenario <name|path.json> [--out <dir>] [--port 5100] [--viewport 540x960]
//        [--fps 30] [--seconds 3] [--throttle 1] [--touch] [--perf] [--dpr 1] [--devtools]
//        [--query "a=1&b=2"] [--rebuild] [--no-build] [--headed] [--keep-server] [--no-contact]
//        [--warmup 1] [--shots 0]
//
// Deterministic mode (default): builds dist/ if stale, starts/reuses `vite preview` on --port, opens
// Chrome (playwright-core, channel "chrome") at ?debug=1&clock=manual, runs the scenario `setup`,
// then for each frame f: fires timeline items at f, steps the sim one frame (1/fps), records
// getState() and a page screenshot. Frame f therefore shows the state after f+1 steps, and an input
// at frame f is visible in frame f at the earliest.
//
// Writes <out>/frames/0000.png…, contact.png, trace.json (getState per frame), meta.json
// {fps, viewport, events:[{frame,label}], responses, …}.
//
// --touch  hasTouch/isMobile context; timeline `input` left/right/jump/roll/tap become REAL swipe /
//          tap gestures dispatched through CDP Input.dispatchTouchEvent at the playfield centre.
// --perf   realtime clock + CDP CPU throttling (--throttle, e.g. 4) for --seconds; writes perf.json with
//          fps percentiles, frame-time percentiles, long frames, draw calls, JS heap / GC sawtooth.
//
// Scenario JSON (tools/scenarios/*.json):
//   { "description": "...", "query": "", "seed": 1, "touch": false,
//     "setup": [["startRun", {"scenario": "flat-straight", "skipIntro": true}], ["cheat", "god", true]],
//     "timeline": [ {"frame": 30, "input": "left", "label": "left"},
//                   {"frame": 40, "call": ["setTuning", "player.jumpHeight", 1.4]},
//                   {"frame": 50, "key": "ArrowUp"},
//                   {"frame": 60, "gesture": {"type": "swipe", "dir": "down", "distance": 90, "steps": 6}} ],
//     "repeatTimelineEvery": 0, "seconds": 3, "fps": 30, "viewport": "540x960" }
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { launchChrome, collectConsole, waitForGame } from "./lib/browser.mjs";
import { ROOT, ensureDir, log, num, pad, parseArgs, parseViewport, sleep } from "./lib/common.mjs";
import { ensureBuild, ensurePreview } from "./lib/server.mjs";
import { buildContactSheet } from "./contact-sheet.mjs";

const BOOLEANS = ["touch", "perf", "devtools", "rebuild", "noBuild", "headed", "keepServer", "noContact", "help"];
const SWIPE_DIRS = { left: [-1, 0], right: [1, 0], jump: [0, -1], up: [0, -1], roll: [0, 1], down: [0, 1] };

function usage(code) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).slice(0, 28).map((l) => l.slice(3)).join("\n"));
  process.exit(code);
}

function loadScenario(ref) {
  const candidates = [ref, `${ref}.json`, join(ROOT, "tools", "scenarios", `${ref}.json`), join(ROOT, "tools", "scenarios", ref)];
  for (const c of candidates) {
    const p = isAbsolute(c) ? c : resolve(c);
    if (existsSync(p) && p.endsWith(".json")) {
      const data = JSON.parse(readFileSync(p, "utf8"));
      const name = p.replace(/\\/g, "/").split("/").pop().replace(/\.json$/, "");
      return { name, path: p, data };
    }
  }
  throw new Error(`scenario "${ref}" not found (looked in tools/scenarios/)`);
}

/** Expands timeline items into [{frame, ...item}] sorted by frame, honouring repeatTimelineEvery. */
function expandTimeline(sc, totalFrames) {
  const base = Array.isArray(sc.timeline) ? sc.timeline : [];
  const every = num(sc.repeatTimelineEvery, 0);
  const out = [];
  for (let offset = 0; offset < totalFrames; offset += every > 0 ? every : totalFrames) {
    for (const item of base) {
      const frame = Math.round(num(item.frame, NaN)) + offset;
      if (!Number.isFinite(frame)) throw new Error(`timeline item without numeric frame: ${JSON.stringify(item)}`);
      if (frame < totalFrames) out.push({ ...item, frame });
    }
    if (!(every > 0)) break;
  }
  return out.sort((a, b) => a.frame - b.frame);
}

function labelOf(item, touch) {
  if (item.label) return item.label;
  if (item.input) return `${touch && SWIPE_DIRS[item.input] ? "swipe" : "input"} ${item.input}`;
  if (item.key) return `key ${item.key}`;
  if (item.gesture) return `gesture ${item.gesture.type ?? "swipe"} ${item.gesture.dir ?? ""}`.trim();
  if (item.call) return item.call.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(" ");
  return "event";
}

async function callGame(page, call) {
  const [method, ...args] = call;
  return page.evaluate(
    async ([m, a]) => {
      const g = window.__game;
      if (typeof g[m] !== "function") throw new Error(`__game.${m} is not a function`);
      const r = await g[m](...a);
      try {
        return JSON.parse(JSON.stringify(r ?? null));
      } catch {
        return null;
      }
    },
    [method, args],
  );
}

function createGestures(page, cdp) {
  let point = null;
  const gesturePoint = async () => {
    if (point) return point;
    point = await page.evaluate(() => {
      const el = document.getElementById("playfield") ?? document.body;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.62 };
    });
    return point;
  };
  const flush = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
  const tp = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 6, radiusY: 6, force: 1 }];
  const swipe = async (dir, g = {}) => {
    const v = SWIPE_DIRS[dir];
    if (!v) throw new Error(`bad swipe dir "${dir}"`);
    const p = await gesturePoint();
    const x0 = g.x ?? p.x;
    const y0 = g.y ?? p.y;
    const distance = num(g.distance, 90);
    const steps = Math.max(1, num(g.steps, 6));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp(x0, y0) });
    for (let i = 1; i <= steps; i++) {
      const k = (distance * i) / steps;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp(x0 + v[0] * k, y0 + v[1] * k) });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const tap = async (g = {}) => {
    const p = await gesturePoint();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp(g.x ?? p.x, g.y ?? p.y) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  return { swipe, tap, flush };
}

/** Fires one timeline item. `waitFlush` = wait for the page to process dispatched input (manual clock). */
async function fire(page, item, ctx, waitFlush) {
  if (item.call) return callGame(page, item.call);
  if (item.key) {
    await page.keyboard.press(item.key);
    return;
  }
  const gesture = item.gesture ?? (ctx.touch && item.input && (SWIPE_DIRS[item.input] || item.input === "tap" || item.input === "hoverboard") ? { type: SWIPE_DIRS[item.input] ? "swipe" : item.input === "tap" ? "tap" : "doubletap", dir: item.input } : null);
  if (gesture) {
    if (!ctx.gestures) throw new Error("gesture items need --touch (or \"touch\": true in the scenario)");
    const type = gesture.type ?? "swipe";
    if (type === "swipe") await ctx.gestures.swipe(gesture.dir, gesture);
    else if (type === "tap") await ctx.gestures.tap(gesture);
    else if (type === "doubletap") {
      await ctx.gestures.tap(gesture);
      await ctx.gestures.tap(gesture);
    } else throw new Error(`unknown gesture type "${type}"`);
    if (waitFlush) await ctx.gestures.flush();
    return;
  }
  if (item.input) return callGame(page, ["input", item.input]);
  throw new Error(`timeline item has nothing to do: ${JSON.stringify(item)}`);
}

/** For each directional input, the first captured frame showing a response (latency in frames). */
function analyzeResponses(fired, trace, initial) {
  const out = [];
  const window = 45;
  for (const ev of fired) {
    const action = ev.action;
    if (!["left", "right", "jump", "roll"].includes(action)) continue;
    let hit = null;
    for (let k = ev.frame; k < Math.min(trace.length, ev.frame + window); k++) {
      const prev = (k === 0 ? initial : trace[k - 1]).player;
      const prev2 = (k <= 1 ? initial : trace[k - 2]).player;
      const cur = trace[k].player;
      const vx = cur.x - prev.x;
      const pvx = prev.x - prev2.x;
      let ok = false;
      if (action === "left") ok = cur.lane < prev.lane || (vx < -1e-4 && !(pvx < -1e-4));
      else if (action === "right") ok = cur.lane > prev.lane || (vx > 1e-4 && !(pvx > 1e-4));
      else if (action === "jump") ok = (cur.vy > 0.01 && !(prev.vy > 0.01)) || (cur.state === "jump" && prev.state !== "jump");
      else if (action === "roll") ok = (cur.rolling && !prev.rolling) || cur.vy < prev.vy - 2;
      if (ok) {
        hit = k;
        break;
      }
    }
    out.push({ frame: ev.frame, action, source: ev.source, label: ev.label, dispatched: ev.dispatched ?? null, firstResponseFrame: hit, latencyFrames: hit === null ? null : hit - ev.frame });
  }
  return out;
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))] : null);
const r2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

function perfStats(rec, warmup) {
  const idx = rec.frameT.map((t, i) => (t >= warmup ? i : -1)).filter((i) => i >= 0);
  const dts = idx.map((i) => rec.dts[i]);
  const sorted = [...dts].sort((a, b) => a - b);
  const total = dts.reduce((a, b) => a + b, 0);
  const samples = rec.samples.filter((s) => s.t >= warmup);
  const heap = samples.map((s) => s.heap).filter((h) => typeof h === "number");
  let maxDrop = 0;
  for (let i = 1; i < heap.length; i++) maxDrop = Math.max(maxDrop, heap[i - 1] - heap[i]);
  const calls = samples.map((s) => s.calls);
  const MB = 1048576;
  const stats = {
    measuredSeconds: r2(total / 1000),
    frames: dts.length,
    fps: { avg: r2(dts.length / (total / 1000)), p50: r2(1000 / pct(sorted, 50)), p5: r2(1000 / pct(sorted, 95)), p1: r2(1000 / pct(sorted, 99)) },
    frameMs: { p50: r2(pct(sorted, 50)), p95: r2(pct(sorted, 95)), p99: r2(pct(sorted, 99)), max: r2(sorted[sorted.length - 1] ?? null) },
    longFrames: { over20ms: dts.filter((d) => d > 20).length, over33ms: dts.filter((d) => d > 33.4).length, over50ms: dts.filter((d) => d > 50).length },
    longTasks: rec.longTasks.filter((t) => t.t >= warmup).length,
    drawCalls: { max: calls.length ? Math.max(...calls) : null, avg: calls.length ? r2(calls.reduce((a, b) => a + b, 0) / calls.length) : null },
    triangles: { max: samples.length ? Math.max(...samples.map((s) => s.tris)) : null },
    heapMB: heap.length
      ? { start: r2(heap[0] / MB), end: r2(heap[heap.length - 1] / MB), min: r2(Math.min(...heap) / MB), max: r2(Math.max(...heap) / MB), maxDrop: r2(maxDrop / MB) }
      : null,
  };
  stats.budgetD5 = {
    "p50 >= 58 fps": stats.fps.p50 !== null && stats.fps.p50 >= 58,
    "p95 frame <= 20 ms": stats.frameMs.p95 !== null && stats.frameMs.p95 <= 20,
    "draw calls <= 120": stats.drawCalls.max !== null && stats.drawCalls.max <= 120,
    "GC sawtooth <= 5 MB": stats.heapMB ? stats.heapMB.maxDrop <= 5 : null,
  };
  return stats;
}

async function main() {
  const a = parseArgs(process.argv.slice(2), BOOLEANS);
  if (a.help) usage(0);
  const ref = a.scenario ?? a._[0];
  if (!ref) usage(1);
  const { name, path: scenarioPath, data: sc } = loadScenario(ref);
  const perf = !!a.perf;
  const touch = !!(a.touch || sc.touch);
  const fps = num(a.fps, num(sc.fps, 30));
  const seconds = num(a.seconds, num(sc.seconds, 3));
  const viewport = parseViewport(a.viewport ?? sc.viewport);
  const dpr = num(a.dpr, num(sc.dpr, 1));
  const port = num(a.port, 5100);
  const throttle = num(a.throttle, num(sc.throttle, 1));
  const devtools = !!(a.devtools || sc.devtools);
  const totalFrames = Math.max(1, Math.round(seconds * fps));
  const out = resolve(a.out ?? join(ROOT, ".captures", `${name}${touch ? "-touch" : ""}${perf ? "-perf" : ""}`));
  const framesDir = join(out, "frames");
  rmSync(framesDir, { recursive: true, force: true });
  ensureDir(framesDir);
  for (const f of ["contact.png", "trace.json", "meta.json", "perf.json"]) rmSync(join(out, f), { force: true });

  const t0 = Date.now();
  const outDir = devtools ? join(ROOT, ".capture", "dist-devtools") : join(ROOT, "dist");
  const build = a.noBuild ? { built: false, reason: "--no-build" } : ensureBuild({ outDir, devtools, force: !!a.rebuild });
  const server = await ensurePreview({ port, outDir });
  if (devtools && server.reused) log("warning: reused an existing server; it may not be serving the devtools build");
  const browser = await launchChrome({ headless: !a.headed });
  let exitCode = 0;
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    const consoleMessages = collectConsole(page);
    const cdp = await context.newCDPSession(page);
    const params = new URLSearchParams({ debug: "1", mute: "1" });
    if (!perf) params.set("clock", "manual");
    if (devtools) params.set("dev", "1");
    for (const q of [sc.query, a.query]) {
      if (!q || q === true) continue;
      for (const [k, v] of new URLSearchParams(String(q).replace(/^\?/, ""))) params.set(k, v);
    }
    const url = `${server.url}?${params}`;
    log(`${name}: ${perf ? `perf ${seconds}s realtime, CPU x${throttle}` : `${totalFrames} frames @ ${fps} fps`}, ${viewport.width}x${viewport.height}@${dpr}${touch ? ", touch" : ""} → ${relative(ROOT, out)}`);
    const tLoad = Date.now();
    await page.goto(url, { waitUntil: "load" });
    await waitForGame(page);
    log(`page ready in ${Date.now() - tLoad} ms`);
    const ctx = { touch, gestures: touch ? createGestures(page, cdp) : null };

    if (!perf) await callGame(page, ["setClock", "manual"]);
    if (sc.seed !== undefined) await callGame(page, ["setSeed", sc.seed]);
    for (const step of sc.setup ?? []) await callGame(page, Array.isArray(step) ? step : step.call);

    const timeline = expandTimeline(sc, totalFrames);
    const fired = [];
    const meta = {
      tool: "capture",
      scenario: name,
      description: sc.description ?? "",
      scenarioFile: relative(ROOT, scenarioPath).split("\\").join("/"),
      url: url.replace(server.url, "/"),
      mode: perf ? "perf" : "manual",
      fps,
      seconds,
      frames: totalFrames,
      viewport,
      dpr,
      touch,
      devtools,
      seed: sc.seed ?? null,
      events: [],
    };
    const record = (item, frame, dispatched) => {
      const source = item.call ? "debug" : item.key ? "keyboard" : item.gesture || (touch && item.input) ? "touch" : "debug";
      const ev = { frame, label: labelOf(item, touch), action: item.input ?? (item.gesture ? item.gesture.dir : null), source, dispatched };
      fired.push(ev);
      meta.events.push({ frame, label: ev.label });
    };
    // Actions the game actually received for each timeline item (window.__game.inputLog).
    const hasInputLog = await page.evaluate(() => typeof window.__game.inputLog === "function");
    let lastSeq = hasInputLog ? await page.evaluate(() => window.__game.inputLog().reduce((m, e) => Math.max(m, e.seq), 0)) : 0;
    const takeDispatched = async () => {
      if (!hasInputLog) return undefined;
      const entries = await page.evaluate((s) => window.__game.inputLog(s), lastSeq);
      if (entries.length) lastSeq = entries[entries.length - 1].seq;
      return entries.map((e) => `${e.action}/${e.source}`);
    };

    if (!perf) {
      // ------------------------------------------------------------ deterministic manual capture
      const initial = await callGame(page, ["getState"]);
      const trace = [];
      const timing = { fireMs: 0, stepMs: 0, shotMs: 0 };
      let ti = 0;
      for (let f = 0; f < totalFrames; f++) {
        let t = Date.now();
        while (ti < timeline.length && timeline[ti].frame === f) {
          await fire(page, timeline[ti], ctx, true);
          record(timeline[ti], f, await takeDispatched());
          ti++;
        }
        timing.fireMs += Date.now() - t;
        t = Date.now();
        const state = await page.evaluate((stepFps) => {
          window.__game.step(1, stepFps);
          return window.__game.getState();
        }, fps);
        trace.push(state);
        timing.stepMs += Date.now() - t;
        t = Date.now();
        // CDP capture (composited page incl. DOM UI); faster than page.screenshot's extra waits.
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
        writeFileSync(join(framesDir, `${pad(f)}.png`), Buffer.from(shot.data, "base64"));
        timing.shotMs += Date.now() - t;
      }
      meta.timing = timing;
      log(`timing: fire ${timing.fireMs} ms · step+state ${timing.stepMs} ms · screenshots ${timing.shotMs} ms`);
      meta.responses = analyzeResponses(fired, trace, initial);
      writeFileSync(join(out, "trace.json"), JSON.stringify(trace));
      const last = trace[trace.length - 1];
      meta.final = { mode: last.mode, screen: last.screen, distance: r2(last.distance), score: last.score, coins: last.coins, playerState: last.player.state };
    } else {
      // ------------------------------------------------------------ realtime perf capture
      await cdp.send("Performance.enable");
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
      await page.evaluate(() => {
        const t0 = performance.now();
        const rec = { dts: [], frameT: [], samples: [], longTasks: [], on: true };
        let last = -1;
        const raf = (now) => {
          if (!rec.on) return;
          if (last >= 0) {
            rec.dts.push(now - last);
            rec.frameT.push((now - t0) / 1000);
          }
          last = now;
          requestAnimationFrame(raf);
        };
        requestAnimationFrame(raf);
        try {
          const po = new PerformanceObserver((l) => {
            for (const e of l.getEntries()) rec.longTasks.push({ t: (e.startTime - t0) / 1000, ms: e.duration });
          });
          po.observe({ type: "longtask", buffered: false });
          rec.po = po;
        } catch {
          /* longtask unsupported */
        }
        const sample = () => {
          const s = window.__game.getState();
          const m = performance.memory;
          rec.samples.push({ t: (performance.now() - t0) / 1000, calls: s.render.calls, tris: s.render.triangles, heap: m ? m.usedJSHeapSize : null, speed: s.speed, distance: s.distance, mode: s.mode, state: s.player.state, lane: s.player.lane, fps: 0 });
        };
        rec.iv = setInterval(sample, 250);
        window.__perfRec = rec;
      });
      const start = Date.now();
      const shotEvery = num(a.shots, 0);
      let nextShot = shotEvery > 0 ? 0 : Infinity;
      let shot = 0;
      let ti = 0;
      for (;;) {
        const el = (Date.now() - start) / 1000;
        if (el >= seconds) break;
        while (ti < timeline.length && timeline[ti].frame / fps <= el) {
          await fire(page, timeline[ti], ctx, false);
          record(timeline[ti], Math.round(el * fps));
          ti++;
        }
        if (el >= nextShot) {
          await page.screenshot({ path: join(framesDir, `${pad(Math.round(el * fps))}.png`) });
          shot++;
          nextShot += shotEvery;
        }
        await sleep(5);
      }
      const rec = await page.evaluate(() => {
        const r = window.__perfRec;
        r.on = false;
        clearInterval(r.iv);
        r.po?.disconnect();
        return { dts: r.dts, frameT: r.frameT, samples: r.samples, longTasks: r.longTasks };
      });
      const metrics = await cdp.send("Performance.getMetrics");
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await page.screenshot({ path: join(framesDir, `${pad(totalFrames)}.png`) });
      const warmup = num(a.warmup, 1);
      const stats = perfStats(rec, warmup);
      const m = Object.fromEntries(metrics.metrics.map((x) => [x.name, x.value]));
      const perfOut = {
        scenario: name,
        throttle,
        viewport,
        dpr,
        seconds,
        warmupSeconds: warmup,
        ...stats,
        cdp: { JSHeapUsedMB: r2(m.JSHeapUsedSize / 1048576), JSHeapTotalMB: r2(m.JSHeapTotalSize / 1048576), Nodes: m.Nodes, LayoutCount: m.LayoutCount, RecalcStyleCount: m.RecalcStyleCount },
        endState: rec.samples[rec.samples.length - 1] ?? null,
      };
      writeFileSync(join(out, "perf.json"), JSON.stringify(perfOut, null, 2));
      writeFileSync(join(out, "trace.json"), JSON.stringify(rec.samples));
      meta.perf = perfOut;
      meta.shots = shot + 1;
      const s = perfOut;
      log(
        `perf: fps p50 ${s.fps.p50} (avg ${s.fps.avg}, p5 ${s.fps.p5}) · frame ms p50 ${s.frameMs.p50} p95 ${s.frameMs.p95} p99 ${s.frameMs.p99} max ${s.frameMs.max} · ` +
          `long >20ms ${s.longFrames.over20ms} >50ms ${s.longFrames.over50ms} · draw calls max ${s.drawCalls.max} · heap ${s.heapMB ? `${s.heapMB.min}-${s.heapMB.max} MB, max drop ${s.heapMB.maxDrop} MB` : "n/a"}`,
      );
      log(`D5 budget: ${Object.entries(s.budgetD5).map(([k, v]) => `${k}: ${v === null ? "n/a" : v ? "PASS" : "FAIL"}`).join(" · ")}`);
    }

    meta.console = consoleMessages;
    meta.build = build.reason;
    meta.captureMs = Date.now() - t0;
    meta.generatedAt = new Date().toISOString();
    writeFileSync(join(out, "meta.json"), JSON.stringify(meta, null, 2));
    if (!a.noContact) {
      const tSheet = Date.now();
      const sheet = await buildContactSheet({ dir: framesDir, out: join(out, "contact.png"), fps, meta, browser });
      log(`contact sheet: ${relative(ROOT, sheet.out)} (${sheet.tiles} tiles, ${Date.now() - tSheet} ms)`);
    }
    if (meta.responses?.length) {
      for (const r of meta.responses) {
        const got = r.dispatched ? ` · game received [${r.dispatched.join(", ")}]` : "";
        const warn = r.dispatched && r.dispatched.length !== 1 ? "  <-- expected exactly 1 action" : "";
        log(`response f${pad(r.frame)} ${r.label}: ${r.latencyFrames === null ? "no visible motion" : `motion after ${r.latencyFrames} frame(s)`}${got}${warn}`);
      }
    }
    // 404s for manifest files not yet authored are expected: those assets use placeholders.
    const errors = consoleMessages.filter((m) => m.type !== "warning" && !/status of 404/.test(m.text));
    if (errors.length) log(`page errors (${errors.length}):\n  ${errors.map((e) => e.text.split("\n")[0]).join("\n  ")}`);
    log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${relative(ROOT, out)}`);
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    await browser.close();
    if (!a.keepServer) await server.stop();
  }
  process.exit(exitCode);
}

mkdirSync(join(ROOT, ".captures"), { recursive: true });
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
