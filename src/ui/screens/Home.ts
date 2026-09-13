import { h, formatInt, setText } from "../dom";
import { registerScreen, type ScreenHost } from "./registry";

registerScreen("home", (host: ScreenHost) => {
  const { assets, brand } = host;
  const best = h("span");
  const coins = h("span");
  const nav = (id: string, label: string) =>
    h("button", {
      class: "btn secondary",
      text: label,
      attrs: { "data-id": id },
      on: {
        click: () => {
          host.bus.emit("ui:click", { id });
          host.goto(id);
        },
      },
    });
  const el = h(
    "div",
    { class: "screen home", attrs: { "data-screen": "home" } },
    h(
      "div",
      { class: "top" },
      h("div", { class: "stat" }, h("img", { attrs: { src: assets.getSpriteUrl("ui.icon.trophy"), alt: "" } }), best),
      h("div", { class: "stat" }, h("img", { attrs: { src: assets.getSpriteUrl("ui.icon.coin"), alt: "" } }), coins),
    ),
    h("img", { class: "logo", attrs: { src: assets.getSpriteUrl("ui.logo"), alt: brand.name } }),
    h("div", { class: "tap", text: brand.copy.tapToPlay }),
    h(
      "div",
      {},
      h("div", { class: "nav" }, nav("shop", "Shop"), nav("missions", "Missions"), nav("leaderboard", "Ranks"), nav("settings", "Settings")),
      h("div", { class: "hint", text: brand.copy.keyboardHint }),
    ),
  );
  return {
    el,
    show() {
      const p = host.store.get();
      setText(best, `${brand.copy.best} ${formatInt(p.stats.bestScore)}`);
      setText(coins, formatInt(p.currencies.coins));
    },
    hide() {},
  };
});
