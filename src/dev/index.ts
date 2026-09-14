/**
 * Devtools entry point (lane D owns src/dev). Only reachable through a dynamic import guarded by
 * `__DEVTOOLS_BUILD__ && flags.devtools` in main.ts, so production bundles built without
 * VITE_DEVTOOLS=1 contain none of this code (verified by `npm run check:devstrip`).
 *
 * This is the MINIMAL panel: toggle (` key, the DEV button, or a 3-finger tap), live stats and one
 * button per registered cheat. The full cheats panel (D1) and the tuning editor (D2) build on
 * `listCheats()` (core/cheats.ts), `tuning.list()` (core/tuning.ts) and `app.store`.
 */
import type { App } from "../App";
import { listCheats, registerCheat, runCheat, type CheatDef } from "../core/cheats";
import { tuning } from "../core/tuning";

export const DEVTOOLS_MARKER = "yard-dash-devtools";

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
.yd-dev{position:fixed;left:6px;right:6px;bottom:calc(env(safe-area-inset-bottom,0px) + 42px);max-width:360px;max-height:62vh;overflow:auto;
  z-index:2147483001;background:rgba(10,14,22,.92);color:#e6edf3;border:1px solid #2f3b52;border-radius:12px;
  font:12px/1.35 ui-monospace,Consolas,monospace;padding:8px 10px;box-shadow:0 8px 30px rgba(0,0,0,.45);touch-action:pan-y;
  -webkit-user-select:text;user-select:text}
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

export function installDevtools(app: App): DevtoolsHandle {
  const style = el("style");
  style.textContent = CSS;
  style.dataset.devtools = DEVTOOLS_MARKER;
  document.head.append(style);

  const fab = el("button", "yd-dev-fab", "DEV");
  fab.type = "button";
  fab.setAttribute("aria-label", "Toggle developer panel");
  const root = el("div", "yd-dev");
  root.dataset.devtools = DEVTOOLS_MARKER;
  root.hidden = true;

  const header = el("header");
  const close = el("button", undefined, "close");
  close.type = "button";
  close.style.flex = "0";
  header.append(el("b", undefined, "Yard Dash dev"), close);
  const stats = el("pre", "stats", "…");
  const list = el("div");
  const foot = el("div", "foot");
  root.append(header, stats, list, foot);
  document.body.append(fab, root);

  const renderCheats = () => {
    list.textContent = "";
    const groups = new Map<string, CheatDef[]>();
    for (const c of listCheats()) {
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group)!.push(c);
    }
    for (const [group, defs] of groups) {
      list.append(el("h4", undefined, group));
      for (const d of defs) list.append(cheatRow(d));
    }
    foot.textContent = `${listCheats().length} cheats · ${tuning.list().length} tuning fields · full panel + editor: D1/D2`;
  };

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
        `speed ${st.speed.toFixed(1)}  dist ${st.distance.toFixed(0)}  lane ${st.player.lane} ${st.player.state}` +
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
      renderCheats();
      windowStart = performance.now();
      last = 0;
      frames = 0;
      raf = requestAnimationFrame(tick);
    }
    return open;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.code === "Backquote" && !e.repeat) {
      e.preventDefault();
      toggle();
    }
  };
  const onTouch = (e: TouchEvent) => {
    if (e.touches.length >= 3) toggle();
  };
  fab.addEventListener("click", () => toggle());
  close.addEventListener("click", () => toggle(false));
  window.addEventListener("keydown", onKey);
  window.addEventListener("touchstart", onTouch, { passive: true });

  registerCheat({
    name: "devPanel",
    label: "Toggle dev panel",
    group: "Dev",
    args: [{ name: "open", kind: "boolean" }],
    run: (open) => toggle(open === undefined ? undefined : !!open),
  });

  console.info(`[dev] ${DEVTOOLS_MARKER}: ${listCheats().length} cheats, ${tuning.list().length} tuning fields; press \` to toggle`);

  return {
    root,
    toggle,
    isOpen: () => !root.hidden,
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouch);
      fab.remove();
      root.remove();
      style.remove();
    },
  };
}
