/** Pause, revive offer and results screens (piece C3). */
import { activeMissions } from "../../meta/missions";
import { h, formatInt, setText } from "../dom";
import { button, progressBar } from "./kit";
import { registerScreen, type ScreenHost } from "./registry";

/** Compact list of the current missions with progress bars (pause + results). */
function missionList(host: ScreenHost): { el: HTMLElement; refresh(): void } {
  const el = h("div", { class: "mission-list" });
  return {
    el,
    refresh() {
      el.textContent = "";
      for (const m of activeMissions(host.store.get())) {
        const bar = progressBar(m.done ? "done" : "");
        bar.set(m.goal > 0 ? m.progress / m.goal : 1);
        el.append(
          h(
            "div",
            { class: `mission${m.done ? " done" : ""}` },
            h("div", { class: "mission-top" }, h("span", { text: m.label }), h("span", { class: "mission-num", text: m.done ? "Done" : `${formatInt(m.progress)}/${formatInt(m.goal)}` })),
            bar.el,
          ),
        );
      }
    },
  };
}

registerScreen("pause", (host) => {
  const missions = missionList(host);
  const el = h(
    "div",
    { class: "screen overlay", attrs: { "data-screen": "pause" } },
    h(
      "div",
      { class: "panel" },
      h("h1", { text: host.brand.copy.paused }),
      missions.el,
      button(host, "resume", host.brand.copy.resume, () => host.goto("run")),
      button(host, "settings", "Settings", () => host.goto("settings"), "btn secondary"),
      button(host, "home", host.brand.copy.home, () => host.goto("home"), "btn secondary"),
    ),
  );
  return { el, show: () => missions.refresh(), hide() {} };
});

registerScreen("revive", (host) => {
  const ring = h("div", { class: "revive-ring" }, h("span", { text: "5" }));
  const ringText = ring.firstChild as HTMLElement;
  const keys = h("div", { class: "revive-keys" });
  const use = button(host, "revive", "Revive", () => host.revive());
  const skip = button(host, "skip-revive", "No thanks", () => host.skipRevive(), "btn secondary");
  const el = h(
    "div",
    { class: "screen overlay", attrs: { "data-screen": "revive" } },
    h("div", { class: "panel" }, h("h1", { text: "Keep running?" }), ring, keys, use, skip),
  );
  let t = 0;
  const paint = () => {
    const total = host.reviveOfferSeconds;
    ring.style.setProperty("--p", String(total > 0 ? t / total : 0));
    setText(ringText, String(Math.max(0, Math.ceil(t))));
  };
  return {
    el,
    show() {
      t = host.reviveOfferSeconds;
      const cost = host.reviveCost();
      setText(use, cost === 1 ? "Revive · 1 key" : `Revive · ${cost} keys`);
      setText(keys, `You have ${formatInt(host.store.get().currencies.keys)} keys`);
      paint();
    },
    hide() {},
    update(dt) {
      if (dt <= 0 || t <= 0) return;
      t -= dt;
      paint();
      if (t <= 0) host.skipRevive();
    },
  };
});

registerScreen("gameover", (host) => {
  const copy = host.brand.copy;
  const title = h("h1", { text: copy.gameOver, attrs: { "data-id": "gameover-title" } });
  const score = h("div", { class: "big", text: "0" });
  const flag = h("div", { class: "best-flag", text: copy.newBest });
  const coins = h("span", { text: "0" });
  const distance = h("span", { text: "0 m" });
  const best = h("span", { text: "0" });
  const rank = h("div", { class: "rank-line" });
  const completed = h("div", { class: "completed" });
  const missions = missionList(host);
  const el = h(
    "div",
    { class: "screen overlay", attrs: { "data-screen": "gameover" } },
    h(
      "div",
      { class: "panel" },
      title,
      score,
      flag,
      h("div", { class: "row" }, h("span", { text: copy.coins }), coins),
      h("div", { class: "row" }, h("span", { text: "Distance" }), distance),
      h("div", { class: "row" }, h("span", { text: copy.best }), best),
      rank,
      completed,
      missions.el,
      button(host, "play-again", copy.playAgain, () => host.startRun()),
      button(host, "home", copy.home, () => host.goto("home"), "btn secondary"),
    ),
  );
  return {
    el,
    show() {
      const r = host.lastResult;
      setText(title, r?.reason === "crash" ? (r.cause === "caught" ? copy.gameOverCaught : copy.gameOverCrash) : copy.gameOver);
      setText(score, formatInt(r?.score ?? 0));
      setText(coins, formatInt(r?.coins ?? 0));
      setText(distance, `${formatInt(r?.distance ?? 0)} m`);
      setText(best, formatInt(r?.best ?? host.store.get().stats.bestScore));
      flag.hidden = !r?.newBest;
      const m = r?.missions;
      completed.textContent = "";
      if (m) {
        for (const label of m.completed) completed.append(h("div", { class: "done-line", text: `✓ ${label}` }));
        if (m.setAdvanced) completed.append(h("div", { class: "mult-up", text: `Multiplier up! Now x${1 + m.multiplierBonus}` }));
      }
      missions.refresh();
      setText(rank, "");
      const pending = host.lastSubmit;
      pending?.then((res) => {
        if (host.lastSubmit === pending && res?.rank) setText(rank, `Global rank #${formatInt(res.rank)}`);
      });
    },
    hide() {},
  };
});
