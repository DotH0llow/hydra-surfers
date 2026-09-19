/**
 * Devtools entry point (lane D owns src/dev). Only reachable through a dynamic import guarded by
 * `__DEVTOOLS_BUILD__ && flags.devtools` in main.ts, so production bundles built without
 * VITE_DEVTOOLS=1 contain none of this code (verified by `npm run check:devstrip`).
 *
 * Panel toggles: ` key, the DEV button, a 3-finger tap, or a long-press in a screen corner.
 *  - Cheats: one row per registered cheat (core/cheats.ts) plus the dev-only cheats registered here.
 *  - Tuning: an editor generated from the tuning registry (search, sliders, per-field reset). Changes
 *    persist in localStorage; presets copy/paste as JSON.
 */
import type { App } from "../App";
import { listCheats, listUnlockSources, registerCheat, runCheat, type CheatDef } from "../core/cheats";
import { tuning, type TuningEntry } from "../core/tuning";
import { CHARACTERS, MOUNTS } from "../meta/catalog";
import { distanceAtTime, timeForDistance } from "./devMath";
import type { GhostRunner } from "../game/ghost/Ghost";
import { GHOST_HZ, GHOST_MAX_SAMPLES } from "../shared/ghost";
import { laneX } from "../game/world/coords";
import { LongPressDetector, MultiFingerTap } from "./triggers";

export const DEVTOOLS_MARKER = "yard-dash-devtools";
const PRESET_KEY = "hydra-surfers.dev-tuning";

export interface DevtoolsHandle {
  readonly root: HTMLElement;
  toggle(open?: boolean): boolean;
  isOpen(): boolean;
  dispose(): void;
}

const CSS = `
.yd-dev-fab{position:fixed;left:calc(env(safe-area-inset-left,0px) + 6px);bottom:calc(env(safe-area-inset-bottom,0px) + 6px);z-index:2147483000;
  font:700 11px/1 ui-monospace,Consolas,monospace;color:#9fe870;background:rgba(10,14,22,.72);border:1px solid #3b4a30;border-radius:8px;
  padding:7px 8px;cursor:pointer;opacity:.55;touch-action:manipulation}
.yd-dev-fab:hover{opacity:1}
.yd-dev{position:fixed;left:6px;right:6px;bottom:calc(env(safe-area-inset-bottom,0px) + 42px);max-width:380px;max-height:70vh;overflow:auto;
  z-index:2147483001;background:rgba(10,14,22,.94);color:#e6edf3;border:1px solid #2f3b52;border-radius:12px;
  font:12px/1.35 ui-monospace,Consolas,monospace;padding:8px 10px;box-shadow:0 8px 30px rgba(0,0,0,.45);touch-action:pan-y;
  overscroll-behavior:contain;-webkit-user-select:text;user-select:text}
.yd-dev[hidden]{display:none!important}
.yd-dev header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
.yd-dev header b{color:#9fe870}
.yd-dev .stats{white-space:pre;color:#b8c4d6;margin:0 0 6px}
.yd-dev h4{margin:8px 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7d8ba1}
.yd-dev .row{display:flex;gap:6px;align-items:center;margin:3px 0}
.yd-dev button{font:inherit;color:#e6edf3;background:#243049;border:1px solid #34445f;border-radius:7px;padding:6px 8px;min-height:32px;cursor:pointer;flex:1;text-align:left}
.yd-dev button:active{background:#33466b}
.yd-dev input{font:inherit;width:72px;min-height:32px;background:#121826;color:#e6edf3;border:1px solid #34445f;border-radius:7px;padding:4px 6px}
.yd-dev .out{color:#9fe870;min-width:44px;text-align:right}
.yd-dev .foot{margin-top:8px;color:#7d8ba1}
.yd-dev .tabs{display:flex;gap:6px;margin:0 0 6px}
.yd-dev .tabs button{text-align:center}
.yd-dev .tabs button.on{background:#33466b;border-color:#9fe870;color:#9fe870}
.yd-dev .search{width:100%;margin:0 0 6px;box-sizing:border-box}
.yd-dev .tools{display:flex;gap:6px;margin:0 0 6px}
.yd-dev .tools button{text-align:center;min-height:28px;padding:3px 6px}
.yd-dev details{border-top:1px solid #243049;padding:2px 0}
.yd-dev summary{cursor:pointer;color:#9fe870;padding:5px 0}
.yd-dev .trow{display:grid;grid-template-columns:minmax(0,1fr) 92px 62px 26px;gap:4px;align-items:center;margin:2px 0}
.yd-dev .trow label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.yd-dev .trow.changed label{color:#ffc83d}
.yd-dev .trow input[type=range]{width:92px;min-height:24px;padding:0}
.yd-dev .trow input[type=number]{width:62px;min-height:26px;padding:2px 4px}
.yd-dev .trow button{min-height:26px;padding:0;text-align:center}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function cheatRow(def: CheatDef): HTMLElement {
  const row = el("div", "row");
  const btn = el("button", undefined, def.label);
  btn.type = "button";
  btn.title = `__game.cheat("${def.name}"${def.args?.length ? ", …" : ""})`;
  const inputs: Array<() => unknown> = [];
  for (const a of def.args ?? []) {
    if (a.kind === "boolean") continue; // omitted boolean arg = toggle
    const input = el("input");
    input.type = a.kind === "number" ? "number" : "text";
    input.placeholder = a.name;
    if (a.default !== undefined) input.value = String(a.default);
    if (a.step !== undefined) input.step = String(a.step);
    inputs.push(() => (a.kind === "number" ? Number(input.value) : input.value));
    row.append(input);
  }
  const out = el("span", "out");
  btn.addEventListener("click", () => {
    try {
      const r = runCheat(def.name, ...inputs.map((f) => f()));
      out.textContent = r === undefined ? "ok" : typeof r === "object" ? "ok" : String(r);
    } catch (err) {
      out.textContent = "err";
      console.error(`[dev] cheat ${def.name} failed`, err);
    }
  });
  row.prepend(btn);
  row.append(out);
  return row;
}

function saveOverrides(): void {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(tuning.overrides()));
  } catch {
    /* private mode / storage full */
  }
}

function tuningRow(e: TuningEntry): HTMLElement {
  const row = el("div", "trow");
  const label = el("label", undefined, e.unit ? `${e.label} (${e.unit})` : e.label);
  label.title = `${e.path}${e.help ? ` · ${e.help}` : ""} · default ${e.default}`;
  const range = el("input");
  range.type = "range";
  const num = el("input");
  num.type = "number";
  for (const input of [range, num]) {
    input.min = String(e.min);
    input.max = String(e.max);
    input.step = String(e.step);
  }
  const reset = el("button", undefined, "↺");
  reset.type = "button";
  reset.title = `Reset to ${e.default}`;
  const sync = () => {
    const v = tuning.get(e.path) ?? e.default;
    range.value = String(v);
    if (document.activeElement !== num) num.value = String(v);
    row.classList.toggle("changed", v !== e.default);
  };
  const apply = (v: number) => {
    if (!Number.isFinite(v)) return;
    tuning.set(e.path, v);
    sync();
    saveOverrides();
  };
  range.addEventListener("input", () => apply(Number(range.value)));
  num.addEventListener("change", () => apply(Number(num.value)));
  reset.addEventListener("click", () => {
    tuning.reset(e.path);
    sync();
    saveOverrides();
  });
  sync();
  row.append(label, range, num, reset);
  return row;
}

export function installDevtools(app: App): DevtoolsHandle {
  // restore tuning tweaks from the last session before anything reads them
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (raw) {
      const n = tuning.load(JSON.parse(raw) as Record<string, number>);
      if (n) console.info(`[dev] restored ${n} tuning override(s) from localStorage`);
    }
  } catch {
    /* ignore corrupt presets */
  }

  const style = el("style");
  style.textContent = CSS;
  style.dataset.devtools = DEVTOOLS_MARKER;
  document.head.append(style);

  const fab = el("button", "yd-dev-fab", "DEV");
  fab.type = "button";
  fab.setAttribute("aria-label", "Toggle developer panel");
  const root = el("div", "yd-dev");
  root.dataset.devtools = DEVTOOLS_MARKER;
  root.dataset.scroll = "1";
  root.hidden = true;

  const header = el("header");
  const close = el("button", undefined, "close");
  close.type = "button";
  close.style.flex = "0";
  header.append(el("b", undefined, "Hydra Surfers dev"), close);
  const stats = el("pre", "stats", "…");

  const tabs = el("div", "tabs");
  const cheatsTab = el("button", "on", "Cheats");
  const tuningTab = el("button", undefined, "Tuning");
  cheatsTab.type = tuningTab.type = "button";
  tabs.append(cheatsTab, tuningTab);

  const cheatsView = el("div");
  const tuningView = el("div");
  tuningView.hidden = true;
  const search = el("input", "search");
  search.type = "search";
  search.placeholder = "Search tuning (path or label)";
  const tools = el("div", "tools");
  const copyBtn = el("button", undefined, "Copy preset");
  const pasteBtn = el("button", undefined, "Paste preset");
  const resetAllBtn = el("button", undefined, "Reset all");
  for (const b of [copyBtn, pasteBtn, resetAllBtn]) b.type = "button";
  tools.append(copyBtn, pasteBtn, resetAllBtn);
  const tuningList = el("div");
  tuningView.append(search, tools, tuningList);

  const foot = el("div", "foot");
  root.append(header, stats, tabs, cheatsView, tuningView, foot);
  document.body.append(fab, root);

  const renderCheats = () => {
    cheatsView.textContent = "";
    const groups = new Map<string, CheatDef[]>();
    for (const c of listCheats()) {
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group)!.push(c);
    }
    for (const [group, defs] of groups) {
      cheatsView.append(el("h4", undefined, group));
      for (const d of defs) cheatsView.append(cheatRow(d));
    }
    foot.textContent = `${listCheats().length} cheats · ${tuning.list().length} tuning fields · \` toggles`;
  };

  const renderTuning = () => {
    tuningList.textContent = "";
    const q = search.value.trim().toLowerCase();
    const groups = new Map<string, TuningEntry[]>();
    for (const e of tuning.list()) {
      if (q && !`${e.path} ${e.label} ${e.groupLabel}`.toLowerCase().includes(q)) continue;
      if (!groups.has(e.groupLabel)) groups.set(e.groupLabel, []);
      groups.get(e.groupLabel)!.push(e);
    }
    for (const [label, entries] of groups) {
      const det = el("details");
      const changed = entries.filter((e) => tuning.get(e.path) !== e.default).length;
      det.append(el("summary", undefined, `${label} (${entries.length}${changed ? `, ${changed} changed` : ""})`));
      const build = () => {
        if (det.dataset.built) return;
        det.dataset.built = "1";
        for (const e of entries) det.append(tuningRow(e));
      };
      det.addEventListener("toggle", () => det.open && build());
      if (q) {
        det.open = true;
        build();
      }
      tuningList.append(det);
    }
    if (!groups.size) tuningList.append(el("div", "foot", "No tuning field matches."));
  };

  let tab: "cheats" | "tuning" = "cheats";
  const showTab = (t: typeof tab) => {
    tab = t;
    cheatsTab.classList.toggle("on", t === "cheats");
    tuningTab.classList.toggle("on", t === "tuning");
    cheatsView.hidden = t !== "cheats";
    tuningView.hidden = t !== "tuning";
    if (t === "cheats") renderCheats();
    else renderTuning();
  };
  cheatsTab.addEventListener("click", () => showTab("cheats"));
  tuningTab.addEventListener("click", () => showTab("tuning"));
  let searchTimer = 0;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderTuning, 150);
  });
  copyBtn.addEventListener("click", () => {
    const json = JSON.stringify(tuning.overrides(), null, 2);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json).then(
        () => (foot.textContent = "Preset copied to the clipboard"),
        () => window.prompt("Copy this preset", json),
      );
    } else {
      window.prompt("Copy this preset", json);
    }
  });
  pasteBtn.addEventListener("click", () => {
    const txt = window.prompt("Paste a tuning preset (JSON object of path: value)");
    if (!txt) return;
    try {
      tuning.reset();
      const n = tuning.load(JSON.parse(txt) as Record<string, number>);
      saveOverrides();
      foot.textContent = `Preset applied: ${n} field(s)`;
      renderTuning();
    } catch (err) {
      foot.textContent = "Preset is not valid JSON";
      console.warn("[dev] bad preset", err);
    }
  });
  resetAllBtn.addEventListener("click", () => {
    tuning.reset();
    saveOverrides();
    renderTuning();
  });

  // live stats (only while open)
  let raf = 0;
  let frames = 0;
  let windowStart = 0;
  let worst = 0;
  let last = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (last) worst = Math.max(worst, now - last);
    last = now;
    frames++;
    if (now - windowStart >= 500) {
      const fps = (frames * 1000) / (now - windowStart);
      const st = app.getState();
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      stats.textContent =
        `fps ${fps.toFixed(0).padStart(3)}  worst ${worst.toFixed(1)} ms\n` +
        `draw ${st.render.calls}  tris ${st.render.triangles}  dpr ${st.render.dpr}\n` +
        `screen ${st.screen}  mode ${st.mode}  clock ${st.clock}\n` +
        `t ${st.runTime.toFixed(0)}s  speed ${st.speed.toFixed(1)}  dist ${st.distance.toFixed(0)}  lane ${st.player.lane} ${st.player.state}` +
        (mem ? `\nheap ${(mem.usedJSHeapSize / 1048576).toFixed(1)} MB` : "");
      frames = 0;
      worst = 0;
      windowStart = now;
    }
  };

  const toggle = (want?: boolean): boolean => {
    const open = want ?? root.hidden !== false;
    root.hidden = !open;
    cancelAnimationFrame(raf);
    if (open) {
      showTab(tab);
      windowStart = performance.now();
      last = 0;
      frames = 0;
      raf = requestAnimationFrame(tick);
    }
    return open;
  };

  // ---- toggles: key, button, 3-finger tap, corner long-press
  const onKey = (e: KeyboardEvent) => {
    if (e.code === "Backquote" && !e.repeat) {
      e.preventDefault();
      toggle();
    }
  };
  const fingers = new MultiFingerTap(3);
  const onTouches = (e: TouchEvent) => {
    if (fingers.touches(e.touches.length)) toggle();
  };
  const press = new LongPressDetector();
  const onPointerDown = (e: PointerEvent) => {
    if (root.contains(e.target as Node)) return;
    if (press.down(e.pointerId, e.clientX, e.clientY, performance.now(), window.innerWidth, window.innerHeight)) {
      window.setTimeout(() => {
        if (press.poll(performance.now())) toggle();
      }, press.opts.holdMs + 10);
    }
  };
  const onPointerMove = (e: PointerEvent) => press.move(e.pointerId, e.clientX, e.clientY);
  const onPointerUp = (e: PointerEvent) => press.up(e.pointerId);

  fab.addEventListener("click", () => toggle());
  close.addEventListener("click", () => toggle(false));
  window.addEventListener("keydown", onKey);
  window.addEventListener("touchstart", onTouches, { passive: true });
  window.addEventListener("touchend", onTouches, { passive: true });
  window.addEventListener("touchcancel", onTouches, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  window.addEventListener("pointercancel", onPointerUp, { passive: true });

  // ---- dev-only cheats
  registerCheat({
    name: "devPanel",
    label: "Toggle dev panel",
    group: "Dev",
    args: [{ name: "open", kind: "boolean" }],
    run: (open) => toggle(open === undefined ? undefined : !!open),
  });

  let noClip = false;
  app.run.addSystem({
    id: "devNoClip",
    order: 1,
    absorbCrash: (_ctx, cause) => noClip && cause !== "cheat",
    absorbStumble: () => noClip,
  });
  registerCheat({
    name: "noClip",
    label: "No-clip (no crashes or bumps)",
    group: "Run",
    args: [{ name: "on", kind: "boolean" }],
    run: (on) => (noClip = on === undefined ? !noClip : !!on),
  });
  registerCheat({
    name: "jumpToTime",
    label: "Jump to run time (s)",
    group: "Run",
    args: [{ name: "seconds", kind: "number", min: 0, max: 3600, step: 10, default: 120 }],
    run: (s) => {
      const t = Math.max(0, Number(s) || 0);
      app.run.warp(t, distanceAtTime(t));
      return Math.round(app.run.state.distance);
    },
  });
  registerCheat({
    name: "ghostDemo",
    label: "Race a test ghost (a few metres ahead, weaving)",
    group: "Run",
    run: () => {
      const ghost = app.run.ctx.getSystem<GhostRunner>("ghost");
      const st = app.run.state;
      if (!ghost) return "no ghost system";
      const n = GHOST_MAX_SAMPLES;
      const track = { count: n, dist: new Float32Array(n), x: new Float32Array(n), y: new Float32Array(n) };
      const speed = Math.max(8, st.speed);
      for (let i = 0; i < n; i++) {
        const dt = i / GHOST_HZ - st.time;
        track.dist[i] = Math.max(0, st.distance + 14 + dt * speed);
        track.x[i] = laneX(Math.round(Math.sin(dt * 0.8)));
        track.y[i] = dt > 0 && dt % 3 < 0.5 ? Math.sin(((dt % 3) / 0.5) * Math.PI) * 1.2 : 0;
      }
      ghost.setTrack(track, "Fantasma de teste");
      return "ok";
    },
  });
  registerCheat({
    name: "jumpToDistance",
    label: "Jump to distance (m)",
    group: "Run",
    args: [{ name: "metres", kind: "number", min: 0, max: 100000, step: 100, default: 2000 }],
    run: (m) => {
      const d = Math.max(0, Number(m) || 0);
      app.run.warp(timeForDistance(d), d);
      return Math.round(app.run.state.time);
    },
  });
  registerCheat({
    name: "unlockAll",
    label: "Unlock all characters and mounts",
    group: "Profile",
    run: () => {
      app.store.update((p) => {
        for (const c of CHARACTERS) if (!p.owned.characters.includes(c.id)) p.owned.characters.push(c.id);
        for (const m of MOUNTS) if (!p.owned.mounts.includes(m.id)) p.owned.mounts.push(m.id);
        for (const [, source] of listUnlockSources()) source(p);
      });
      return CHARACTERS.length + MOUNTS.length;
    },
  });

  console.info(`[dev] ${DEVTOOLS_MARKER}: ${listCheats().length} cheats, ${tuning.list().length} tuning fields; press \` to toggle`);

  return {
    root,
    toggle,
    isOpen: () => !root.hidden,
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouches);
      window.removeEventListener("touchend", onTouches);
      window.removeEventListener("touchcancel", onTouches);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      app.run.removeSystem("devNoClip");
      fab.remove();
      root.remove();
      style.remove();
    },
  };
}
