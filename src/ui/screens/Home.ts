/**
 * The tavern — the hub between runs.
 *
 * It answers, in order, the three questions a returning player has: who am I (crest, title,
 * level), what is on today (the free run, the daily run and how many ranked attempts are left, the
 * weekly challenge, a tournament if one is open) and where do I go next (contracts, arsenal,
 * market, champions, crest, season). A rival line from the leaderboard sits on top when online.
 */
import { SEASON, seasonLevel } from "../../shared/content/season";
import { nextDayStart, nextWeekStart } from "../../shared/calendar";
import { accountLevel, attemptsUsed } from "../../meta/progression";
import { activeContracts } from "../../meta/contracts";
import { buildSummary } from "../../meta/equipment";
import { availableModes, type RunMode } from "../../meta/modes";
import { titleName } from "../../meta/titles";
import { crestSvg } from "../crest";
import { h, formatInt, setText, untilText } from "../dom";
import { progressBar } from "./kit";
import { registerScreen, type ScreenHost } from "./registry";

registerScreen("home", (host: ScreenHost) => {
  const crest = h("div", { class: "tv-crest" });
  const name = h("b", { class: "tv-name" });
  const title = h("span", { class: "tv-title" });
  const level = h("span", { class: "tv-level" });
  const levelBar = progressBar("gold");
  const coins = h("b");
  const keys = h("b");
  const mounts = h("b");
  const rival = h("div", { class: "tv-rival" });
  const modes = h("div", { class: "tv-modes" });
  const build = h("div", { class: "tv-build interactive", attrs: { "data-id": "build-summary" } });
  build.addEventListener("click", () => go("arsenal"));
  const contractsBadge = h("i", { class: "badge" });

  function go(id: string): void {
    host.bus.emit("ui:click", { id });
    host.goto(id);
  }

  const navButton = (id: string, label: string, extra?: Node) => {
    const b = h("button", { class: "btn secondary nav-btn", attrs: { "data-id": id, type: "button" } }, h("span", { text: label }), extra ?? null);
    b.addEventListener("click", () => go(id));
    return b;
  };

  const header = h(
    "div",
    { class: "tv-header interactive", attrs: { "data-id": "profile-card" } },
    crest,
    h("div", { class: "tv-who" }, name, title, h("div", { class: "tv-levelrow" }, level, levelBar.el)),
  );
  header.addEventListener("click", () => go("profile"));

  const el = h(
    "div",
    { class: "screen home tavern", attrs: { "data-screen": "home" } },
    header,
    h(
      "div",
      { class: "wallet" },
      h("div", { class: "chip chip-coin" }, h("span", { class: "chip-label", text: "MOEDAS" }), coins),
      h("div", { class: "chip chip-key" }, h("span", { class: "chip-label", text: "CHAVES" }), keys),
      h("div", { class: "chip chip-mount" }, h("span", { class: "chip-label", text: "MONTARIAS" }), mounts),
    ),
    rival,
    modes,
    build,
    h(
      "div",
      { class: "nav tv-nav" },
      navButton("contracts", "Contratos", contractsBadge),
      navButton("arsenal", "Arsenal"),
      navButton("shop", "Mercado"),
      navButton("leaderboard", "Campeões"),
      navButton("season", "Temporada"),
      navButton("settings", "Ajustes"),
    ),
    h("div", { class: "hint", text: host.brand.copy.keyboardHint }),
  );

  const modeCard = (mode: RunMode) => {
    const now = Date.now();
    const p = host.store.get();
    const card = h("button", { class: `mode-card mode-${mode.id}`, attrs: { "data-id": `mode-${mode.id}`, type: "button" } });
    card.append(h("b", { class: "mode-name", text: mode.name }), h("span", { class: "mode-desc", text: mode.description }));
    if (mode.attempts > 0) {
      const used = attemptsUsed(p, mode.board, mode.period);
      const left = Math.max(0, mode.attempts - used);
      const best = p.modes[mode.board]?.period === mode.period ? p.modes[mode.board].best : 0;
      const reset = mode.id === "daily" ? nextDayStart(now) : mode.id === "weekly" ? nextWeekStart(now) : 0;
      const bits = [left > 0 ? `${left}/${mode.attempts} tentativas` : "Tentativas usadas: treino livre"];
      if (best > 0) bits.push(`seu melhor: ${formatInt(best)}`);
      if (reset) bits.push(untilText(reset - now));
      card.append(h("span", { class: "mode-meta", text: bits.join(" · ") }));
      card.classList.toggle("spent", left === 0);
    }
    card.addEventListener("click", () => {
      host.bus.emit("ui:click", { id: `mode-${mode.id}` });
      host.startRun({ mode: mode.id });
    });
    return card;
  };

  return {
    el,
    show() {
      const p = host.store.get();
      crest.innerHTML = crestSvg(p.equipped.crest, 56);
      setText(name, host.playerName);
      const t = titleName(p.equipped.title);
      setText(title, t);
      title.hidden = !t;
      const lvl = accountLevel(p.progress.xp);
      const seasonLvl = seasonLevel(p.progress.seasonXp);
      setText(level, `Nível ${lvl} · Temporada ${seasonLvl}/${SEASON.levels}`);
      levelBar.set((p.progress.xp % SEASON.xpPerLevel) / SEASON.xpPerLevel);
      setText(coins, formatInt(p.currencies.coins));
      setText(keys, formatInt(p.currencies.keys));
      setText(mounts, formatInt(p.currencies.mounts));
      setText(build, `⚔ ${buildSummary(p)}`);

      const claimable = activeContracts(p, Date.now()).filter((c) => c.done && !c.claimed).length;
      setText(contractsBadge, claimable ? String(claimable) : "");
      contractsBadge.hidden = claimable === 0;

      modes.textContent = "";
      for (const mode of availableModes(Date.now())) modes.append(modeCard(mode));

      // rival line: fetched fresh each visit, silently absent offline
      setText(rival, "");
      rival.hidden = true;
      host.rivalLine().then((line) => {
        if (!line) return;
        setText(rival, line);
        rival.hidden = false;
      });
    },
    hide() {},
  };
});
