/** Home (piece C2): runner idle on the track, currencies, multiplier, mission summary, navigation. */
import { activeMissions, multiplierBonus } from "../../meta/missions";
import { h, formatInt, setText } from "../dom";
import { chip } from "./kit";
import { registerScreen, type ScreenHost } from "./registry";

registerScreen("home", (host: ScreenHost) => {
  const { assets, brand } = host;
  const best = h("span");
  const coins = h("span");
  const keys = chip("key", "KEYS");
  const mult = h("div", { class: "home-mult" });
  const missions = h("div", { class: "home-missions interactive", attrs: { "data-id": "missions-card" } });
  missions.addEventListener("click", () => {
    host.bus.emit("ui:click", { id: "missions-card" });
    host.goto("missions");
  });
  const nav = (id: string, label: string) =>
    h("button", {
      class: "btn secondary",
      text: label,
      attrs: { "data-id": id, type: "button" },
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
      h("div", { class: "top-right" }, keys.el, h("div", { class: "stat" }, h("img", { attrs: { src: assets.getSpriteUrl("ui.icon.coin"), alt: "" } }), coins)),
    ),
    h("img", { class: "logo", attrs: { src: assets.getSpriteUrl("ui.logo"), alt: brand.name } }),
    mult,
    h("div", { class: "tap", text: brand.copy.tapToPlay }),
    h(
      "div",
      { class: "home-bottom" },
      missions,
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
      setText(keys.value, formatInt(p.currencies.keys));
      setText(mult, `Score multiplier x${1 + multiplierBonus(p)}`);
      missions.textContent = "";
      for (const m of activeMissions(p)) {
        missions.append(
          h("div", { class: `home-mission${m.done ? " done" : ""}` }, h("span", { text: m.label }), h("b", { text: m.done ? "✓" : `${formatInt(m.progress)}/${formatInt(m.goal)}` })),
        );
      }
    },
    hide() {},
  };
});
