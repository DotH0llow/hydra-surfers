/**
 * Pause, revive offer and the results screen.
 *
 * The results screen shows only what CHANGED, in the order a player cares about it: the score,
 * where it put them (rank movement, who is right above), what they earned, and what broke
 * (records, contracts, achievements). Sections that are empty are not drawn at all, so a quiet run
 * gives a short screen and a great run gives a celebration.
 */
import { SEASON } from "../../shared/content/season";
import { activeMissions } from "../../meta/missions";
import { describeReward } from "../../meta/rewards";
import { h, formatInt, setText } from "../dom";
import { button, progressBar } from "./kit";
import { registerScreen, type ScreenHost } from "./registry";

/** Compact list of the guild contracts with progress bars (pause screen). */
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
            h("div", { class: "mission-top" }, h("span", { text: m.label }), h("span", { class: "mission-num", text: m.done ? "Feito" : `${formatInt(m.progress)}/${formatInt(m.goal)}` })),
            bar.el,
          ),
        );
      }
    },
  };
}

registerScreen("pause", (host) => {
  const missions = missionList(host);
  const mode = h("div", { class: "mode-tag" });
  const el = h(
    "div",
    { class: "screen overlay", attrs: { "data-screen": "pause" } },
    h(
      "div",
      { class: "panel" },
      h("h1", { text: host.brand.copy.paused }),
      mode,
      missions.el,
      button(host, "resume", host.brand.copy.resume, () => host.goto("run")),
      button(host, "settings", "Ajustes", () => host.goto("settings"), "btn secondary"),
      button(host, "home", "Desistir e voltar à taverna", () => host.goto("home"), "btn secondary"),
    ),
  );
  return {
    el,
    show() {
      setText(mode, host.currentMode.name);
      missions.refresh();
    },
    hide() {},
  };
});

registerScreen("revive", (host) => {
  const ring = h("div", { class: "revive-ring" }, h("span", { text: "5" }));
  const ringText = ring.firstChild as HTMLElement;
  const keys = h("div", { class: "revive-keys" });
  const use = button(host, "revive", "Reerguer-se", () => host.revive());
  const skip = button(host, "skip-revive", "Não, obrigado", () => host.skipRevive(), "btn secondary");
  const el = h("div", { class: "screen overlay", attrs: { "data-screen": "revive" } }, h("div", { class: "panel" }, h("h1", { text: "Continuar a fuga?" }), ring, keys, use, skip));
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
      setText(use, cost === 1 ? "Reerguer-se · 1 chave" : `Reerguer-se · ${cost} chaves`);
      setText(keys, `Você tem ${formatInt(host.store.get().currencies.keys)} chaves`);
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
  const title = h("h1", { attrs: { "data-id": "gameover-title" } });
  const modeTag = h("div", { class: "mode-tag" });
  const score = h("div", { class: "big", text: "0" });
  const flag = h("div", { class: "best-flag", text: copy.newBest });
  const stats = h("div", { class: "result-stats" });
  const social = h("div", { class: "social" });
  const progress = h("div", { class: "result-progress" });
  const xpLine = h("div", { class: "xp-line" });
  const xpBar = progressBar("gold");
  const lists = h("div", { class: "result-lists" });
  const again = button(host, "play-again", copy.playAgain, () => host.startRun({ mode: host.currentMode.id }));

  const el = h(
    "div",
    { class: "screen overlay", attrs: { "data-screen": "gameover" } },
    h(
      "div",
      { class: "panel results" },
      title,
      modeTag,
      score,
      flag,
      social,
      stats,
      progress,
      lists,
      again,
      button(host, "home", "Taverna", () => host.goto("home"), "btn secondary"),
    ),
  );
  progress.append(xpLine, xpBar.el);

  const stat = (label: string, value: string) => h("div", { class: "rs" }, h("b", { text: value }), h("small", { text: label }));

  const section = (label: string, lines: string[], cls = "") => {
    if (!lines.length) return;
    lists.append(h("div", { class: `rl ${cls}` }, h("h2", { text: label }), ...lines.slice(0, 5).map((l) => h("div", { class: "rl-line", text: l }))));
  };

  return {
    el,
    show() {
      const r = host.lastResult;
      const rep = r?.report;
      const heading = r?.reason === "time" ? copy.gameOverTime : r?.reason === "crash" ? (r.cause === "caught" ? copy.gameOverCaught : copy.gameOverCrash) : copy.gameOver;
      setText(title, heading);
      const board = r?.board ?? "season";
      setText(modeTag, board === "season" ? (r?.modeName ?? "") : `${r?.modeName ?? ""} · ${r?.ranked ? "tentativa válida" : "treino (tentativas esgotadas)"}`);
      modeTag.classList.toggle("practice", r?.ranked === false);
      setText(score, formatInt(r?.score ?? 0));
      flag.hidden = !r?.newBest;

      stats.textContent = "";
      const coinsEarned = rep?.coinsEarned ?? r?.coins ?? 0;
      stats.append(
        stat("metros", formatInt(r?.distance ?? 0)),
        stat(coinsEarned > (r?.coins ?? 0) ? `moedas (+${formatInt(coinsEarned - (r?.coins ?? 0))} bônus)` : "moedas", formatInt(coinsEarned)),
      );
      const s = r?.stats;
      if (s) {
        if (s.maxCombo > 0) stats.append(stat("combo máx.", formatInt(s.maxCombo)));
        if (s.nearMisses > 0) stats.append(stat("raspadas", formatInt(s.nearMisses)));
        if (s.perfectDodges > 0) stats.append(stat("perfeitas", formatInt(s.perfectDodges)));
      }

      // XP and levels
      if (rep) {
        const levelUp = rep.levelAfter > rep.levelBefore ? ` · subiu para o nível ${rep.levelAfter}!` : "";
        const seasonUp = rep.seasonLevelAfter > rep.seasonLevelBefore ? ` · temporada ${rep.seasonLevelAfter}/${SEASON.levels}` : "";
        setText(xpLine, `+${formatInt(rep.xpEarned)} XP${rep.xpCapped ? " (limite do dia)" : ""}${levelUp}${seasonUp}`);
        const p = host.store.get();
        xpBar.set((p.progress.xp % SEASON.xpPerLevel) / SEASON.xpPerLevel);
      }
      progress.hidden = !rep;

      lists.textContent = "";
      if (rep) {
        section("Recordes pessoais", rep.records.map((x) => `${x.label}: ${formatInt(x.value)}${x.metres ? " m" : ""} (antes ${formatInt(x.previous)})`), "records");
        section("Contratos cumpridos", rep.contracts.completed.map((c) => `✓ ${c.label} — receba no quadro`));
        if (rep.missions?.setAdvanced) section("Guilda", [`Multiplicador da guilda agora x${1 + rep.missions.multiplierBonus}`]);
        section("Conquistas", rep.achievements.map((a) => `★ ${a.name}${a.reward ? ` · ${describeReward(a.reward)}` : ""}`), "ach");
        const rewards = rep.seasonRewards.map((rw) => `Temporada: ${describeReward(rw)}`);
        if (rep.streak) rewards.unshift(`Dia ${rep.streak.count} seguido: ${describeReward(rep.streak.reward)}`);
        section("Recompensas", rewards);
      }

      // social: rank movement and the rival right above, as soon as the server answers
      social.textContent = "";
      const pending = host.lastSubmit;
      pending?.then((res) => {
        if (host.lastSubmit !== pending || !res) return;
        const lines: string[] = [];
        if (res.rank !== null) {
          const where = board === "daily" ? "no Diário" : board === "weekly" ? "no Semanal" : board.startsWith("event:") ? "no torneio" : "na temporada";
          if (res.passed.length > 0) {
            const names = res.passed.length === 1 ? res.passed[0] : `${res.passed.slice(0, -1).join(", ")} e ${res.passed[res.passed.length - 1]}`;
            lines.push(`Você passou ${names}!`);
          }
          if (res.previousRank === null) lines.push(`Você entrou ${where} em #${res.rank}.`);
          else if (res.rank < res.previousRank) lines.push(`Você subiu de #${res.previousRank} para #${res.rank} ${where}!`);
          else lines.push(`Você é #${res.rank} ${where}.`);
        }
        if (res.above) lines.push(`Faltam ${formatInt(Math.max(1, res.above.value - res.best + 1))} pontos para passar ${res.above.name}.`);
        else if (res.rank === 1) lines.push("Ninguém está à sua frente.");
        for (const l of lines) social.append(h("div", { class: "social-line", text: l }));
      });
    },
    hide() {},
  };
});
