import { h, setText } from "../dom";
import { registerScreen, type ScreenHost } from "./registry";

registerScreen("run", (host: ScreenHost) => {
  const score = h("div", { class: "stat score", text: "0" });
  const mult = h("div", { class: "stat mult", text: "x1" });
  const coins = h("span", { text: "0" });
  const pause = h(
    "button",
    {
      class: "btn icon secondary",
      attrs: { "aria-label": "Pause", "data-id": "pause" },
      on: {
        click: () => {
          host.bus.emit("ui:click", { id: "pause" });
          host.goto("pause");
        },
      },
    },
    h("img", { attrs: { src: host.assets.getSpriteUrl("ui.icon.pause"), alt: "" } }),
  );
  const el = h(
    "div",
    { class: "screen hud", attrs: { "data-screen": "run" } },
    h("div", {}, pause),
    h(
      "div",
      { class: "right" },
      score,
      mult,
      h("div", { class: "stat coins" }, h("img", { attrs: { src: host.assets.getSpriteUrl("ui.icon.coin"), alt: "" } }), coins),
    ),
  );
  let lastScore = -1;
  let lastCoins = -1;
  let lastMult = -1;
  return {
    el,
    show() {
      lastScore = lastCoins = lastMult = -1;
    },
    hide() {},
    update() {
      const st = host.runState;
      if (st.score !== lastScore) {
        lastScore = st.score;
        setText(score, String(st.score));
      }
      if (st.coins !== lastCoins) {
        lastCoins = st.coins;
        setText(coins, String(st.coins));
      }
      if (st.multiplier !== lastMult) {
        lastMult = st.multiplier;
        setText(mult, `x${st.multiplier}`);
      }
    },
  };
});
