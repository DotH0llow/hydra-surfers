/** Pause, game over and placeholder screens (shop/missions/leaderboard/settings). */
import { h, formatInt, setText } from "../dom";
import { registerScreen, type ScreenHost } from "./registry";

function button(host: ScreenHost, id: string, label: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  return h("button", {
    class: cls,
    text: label,
    attrs: { "data-id": id },
    on: {
      click: () => {
        host.bus.emit("ui:click", { id });
        onClick();
      },
    },
  });
}

registerScreen("pause", (host) => {
  const el = h(
    "div",
    { class: "screen overlay", attrs: { "data-screen": "pause" } },
    h(
      "div",
      { class: "panel" },
      h("h1", { text: host.brand.copy.paused }),
      button(host, "resume", host.brand.copy.resume, () => host.goto("run")),
      button(host, "home", host.brand.copy.home, () => host.goto("home"), "btn secondary"),
    ),
  );
  return { el, show() {}, hide() {} };
});

registerScreen("gameover", (host) => {
  const score = h("div", { class: "big", text: "0" });
  const coins = h("span", { text: "0" });
  const best = h("span", { text: "0" });
  const flag = h("div", { class: "best-flag", text: host.brand.copy.newBest });
  const el = h(
    "div",
    { class: "screen overlay", attrs: { "data-screen": "gameover" } },
    h(
      "div",
      { class: "panel" },
      h("h1", { text: host.brand.copy.gameOver }),
      score,
      flag,
      h("div", { class: "row" }, h("span", { text: host.brand.copy.coins }), coins),
      h("div", { class: "row" }, h("span", { text: host.brand.copy.best }), best),
      button(host, "play-again", host.brand.copy.playAgain, () => host.startRun()),
      button(host, "home", host.brand.copy.home, () => host.goto("home"), "btn secondary"),
    ),
  );
  return {
    el,
    show() {
      const r = host.lastResult;
      setText(score, formatInt(r?.score ?? 0));
      setText(coins, formatInt(r?.coins ?? 0));
      setText(best, formatInt(r?.best ?? host.store.get().stats.bestScore));
      flag.hidden = !r?.newBest;
    },
    hide() {},
  };
});

for (const [name, title] of [
  ["shop", "Shop"],
  ["missions", "Missions"],
  ["leaderboard", "Leaderboard"],
  ["settings", "Settings"],
] as const) {
  registerScreen(name, (host) => {
    const el = h(
      "div",
      { class: "screen overlay", attrs: { "data-screen": name } },
      h(
        "div",
        { class: "panel" },
        h("h1", { text: title }),
        h("div", { text: host.brand.copy.comingSoon }),
        button(host, "back", host.brand.copy.back, () => host.goto("home"), "btn secondary"),
      ),
    );
    return { el, show() {}, hide() {} };
  });
}
