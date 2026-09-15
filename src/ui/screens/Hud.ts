/**
 * In-run HUD (piece C1): score with multiplier badge, coin counter, pause, hoverboard button,
 * power-up timers, resume countdown and toasts (mission complete, key collected).
 */
import { HUD } from "../hud/tuning";
import { h, setText } from "../dom";
import { registerScreen, type ScreenHost } from "./registry";

const POWERUP_UI: Record<string, { label: string; color: string }> = {
  jetpack: { label: "Jetpack", color: "#7fd1ff" },
  sneakers: { label: "Sneakers", color: "#57e389" },
  magnet: { label: "Magnet", color: "#ff6b6b" },
  multiplier: { label: "2x Score", color: "#b57bff" },
};

const TIMER_ROWS = 4;

registerScreen("run", (host: ScreenHost) => {
  const tapButton = (id: string, cls: string, label: string, onClick: () => void, ...children: Node[]) =>
    h(
      "button",
      {
        class: cls,
        attrs: { "aria-label": label, "data-id": id, type: "button" },
        on: {
          click: () => {
            host.bus.emit("ui:click", { id });
            onClick();
          },
        },
      },
      ...children,
    );

  const pause = tapButton("pause", "btn icon secondary", "Pause", () => host.goto("pause"), h("img", { attrs: { src: host.assets.getSpriteUrl("ui.icon.pause"), alt: "" } }));
  const boardCount = h("span", { class: "count", text: "0" });
  const board = tapButton("hoverboard", "btn icon board-btn", "Hoverboard", () => host.action("hoverboard"), h("span", { class: "board-glyph" }), boardCount);

  const score = h("div", { class: "stat score", text: "0" });
  const mult = h("div", { class: "mult", text: "x1" });
  const coinsText = h("span", { text: "0" });
  const coins = h("div", { class: "stat coins" }, h("img", { attrs: { src: host.assets.getSpriteUrl("ui.icon.coin"), alt: "" } }), coinsText);

  const timers = h("div", { class: "timers" });
  const rows: Array<{ row: HTMLElement; label: HTMLElement; fill: HTMLElement }> = [];
  for (let i = 0; i < TIMER_ROWS; i++) {
    const label = h("span", { class: "label" });
    const fill = h("div", { class: "fill" });
    const row = h("div", { class: "timer" }, label, h("div", { class: "bar" }, fill));
    row.hidden = true;
    timers.append(row);
    rows.push({ row, label, fill });
  }

  const countdown = h("div", { class: "countdown" });
  countdown.hidden = true;
  const toast = h("div", { class: "toast" });
  toast.hidden = true;

  const el = h(
    "div",
    { class: "screen hud", attrs: { "data-screen": "run" } },
    h("div", { class: "left" }, pause, board),
    h("div", { class: "right" }, h("div", { class: "score-row" }, mult, score), coins),
    timers,
    countdown,
    toast,
  );

  const queue: string[] = [];
  host.bus.on("ui:toast", ({ text }) => {
    if (queue.length < HUD.toastQueue) queue.push(text);
  });
  host.bus.on("run:start", () => {
    queue.length = 0;
    toast.hidden = true;
    toastT = 0;
  });

  let lastScore = -1;
  let lastCoins = -1;
  let lastMult = -1;
  let lastCharges = -2;
  let popT = 0;
  let pollT = 0;
  let toastT = 0;

  return {
    el,
    show() {
      lastScore = lastCoins = lastMult = -1;
      lastCharges = -2;
      pollT = 0;
    },
    hide() {},
    update(dt) {
      const st = host.runState;
      if (st.score !== lastScore) {
        lastScore = st.score;
        setText(score, String(st.score).padStart(HUD.scoreMinDigits, "0"));
      }
      if (st.coins !== lastCoins) {
        if (lastCoins >= 0 && st.coins > lastCoins) popT = HUD.popSeconds;
        lastCoins = st.coins;
        setText(coinsText, String(st.coins));
      }
      if (popT > 0) {
        popT = Math.max(0, popT - dt);
        const k = HUD.popSeconds > 0 ? popT / HUD.popSeconds : 0;
        coins.style.transform = `scale(${(1 + (HUD.popScale - 1) * Math.sin(k * Math.PI)).toFixed(3)})`;
      }
      if (st.multiplier !== lastMult) {
        lastMult = st.multiplier;
        setText(mult, `x${st.multiplier}`);
        mult.classList.toggle("hot", st.multiplier > 1);
      }

      const hb = host.hoverboard;
      const live = st.mode === "running" || st.mode === "intro";
      const riding = !!hb?.active;
      board.hidden = !hb || !live || (!riding && hb.charges < 1);
      board.classList.toggle("riding", riding);
      const charges = hb ? (Number.isFinite(hb.charges) ? hb.charges : 99) : 0;
      if (charges !== lastCharges) {
        lastCharges = charges;
        setText(boardCount, String(charges));
      }

      pollT -= dt;
      if (pollT <= 0) {
        pollT = 0.1;
        const snap = host.powerups?.snapshot() ?? [];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const a = snap[i];
          r.row.hidden = !a;
          if (!a) continue;
          const ui = POWERUP_UI[a.id];
          setText(r.label, ui?.label ?? a.id);
          r.fill.style.width = `${((a.duration > 0 ? a.remaining / a.duration : 0) * 100).toFixed(1)}%`;
          r.fill.style.background = ui?.color ?? "#ffffff";
          r.row.classList.toggle("blink", a.remaining < HUD.timerBlinkSeconds);
        }
      }

      const c = host.resumeCountdown;
      countdown.hidden = c <= 0;
      if (c > 0) setText(countdown, String(Math.ceil(c)));

      if (toastT > 0) {
        toastT -= dt;
        if (toastT <= 0) toast.hidden = true;
      } else if (queue.length && dt > 0) {
        setText(toast, queue.shift()!);
        toast.hidden = false;
        toast.classList.remove("in");
        void toast.offsetWidth;
        toast.classList.add("in");
        toastT = HUD.toastSeconds;
      }
    },
  };
});
