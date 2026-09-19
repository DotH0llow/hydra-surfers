/** Menu screens reached from the tavern: the market, the book of champions and the settings. */
import { KEY_PRICE, MAX_UPGRADE_LEVEL, MOUNT_PRICE, UPGRADE_IDS, buyKey, buyMount, buyUpgrade, readUpgrades, upgradeCost, type UpgradeId } from "../../meta/upgrades";
import { availableModes } from "../../meta/modes";
import { findTitle } from "../../meta/titles";
import type { Board, Metric } from "../../online/LeaderboardService";
import { crestFromId, crestSvg } from "../crest";
import { h, formatInt, setText } from "../dom";
import { button, chip } from "./kit";
import { registerScreen, type ScreenHost } from "./registry";

function menuScreen(host: ScreenHost, name: string, title: string, ...body: Node[]): HTMLElement {
  return h(
    "div",
    { class: "screen overlay menu", attrs: { "data-screen": name } },
    h("div", { class: "panel" }, h("h1", { text: title }), ...body, button(host, "back", host.brand.copy.back, () => host.goto("home"), "btn secondary")),
  );
}

// ------------------------------------------------------------------ market

const UPGRADE_LABELS: Record<UpgradeId, string> = {
  jetpack: "Asas do Grifo",
  sneakers: "Botas do Gigante",
  magnet: "Amuleto Magnético",
  multiplier: "Bênção do Rei",
};

registerScreen("shop", (host) => {
  const coins = chip("coin", "MOEDAS");
  const keys = chip("key", "CHAVES");
  const mounts = chip("mount", "MONTARIAS");
  const wallet = h("div", { class: "wallet" }, coins.el, keys.el, mounts.el);

  const buy = (id: string, fn: (p: Parameters<Parameters<typeof host.store.update>[0]>[0]) => boolean, row: HTMLElement) => {
    let ok = false;
    host.store.update((p) => (ok = fn(p)));
    row.classList.remove("bought", "denied");
    void row.offsetWidth;
    row.classList.add(ok ? "bought" : "denied");
    host.bus.emit("ui:click", { id });
    refresh();
  };

  const item = (id: string, name: string, desc: string, price: number, fn: Parameters<typeof buy>[1]) => {
    const priceBtn = h("button", { class: "btn buy", text: formatInt(price), attrs: { "data-id": `buy-${id}`, type: "button" } });
    const row = h("div", { class: "shop-row" }, h("div", { class: "shop-info" }, h("b", { text: name }), h("small", { text: desc })), priceBtn);
    priceBtn.addEventListener("click", () => buy(`buy-${id}`, fn, row));
    return { row, priceBtn, price };
  };

  const mountItem = item("mount", "Carga de montaria", "Absorve uma queda. Toque duas vezes para montar.", MOUNT_PRICE, buyMount);
  const keyItem = item("key", "Chave", "Reergue você depois de uma queda.", KEY_PRICE, buyKey);

  const upgradeRows = UPGRADE_IDS.map((id) => {
    const pips = h("div", { class: "pips" });
    for (let i = 0; i < MAX_UPGRADE_LEVEL; i++) pips.append(h("i"));
    const priceBtn = h("button", { class: "btn buy", text: "", attrs: { "data-id": `upgrade-${id}`, type: "button" } });
    const row = h("div", { class: "shop-row" }, h("div", { class: "shop-info" }, h("b", { text: UPGRADE_LABELS[id] }), pips), priceBtn);
    priceBtn.addEventListener("click", () => buy(`upgrade-${id}`, (p) => buyUpgrade(p, id), row));
    return { id, row, pips, priceBtn };
  });

  const refresh = () => {
    const p = host.store.get();
    setText(coins.value, formatInt(p.currencies.coins));
    setText(keys.value, formatInt(p.currencies.keys));
    setText(mounts.value, formatInt(p.currencies.mounts));
    for (const it of [mountItem, keyItem]) it.priceBtn.disabled = p.currencies.coins < it.price;
    const levels = readUpgrades(p);
    for (const r of upgradeRows) {
      const lvl = levels[r.id];
      r.pips.querySelectorAll("i").forEach((pip, i) => pip.classList.toggle("on", i < lvl));
      const cost = upgradeCost(lvl);
      setText(r.priceBtn, cost === null ? "MÁX" : formatInt(cost));
      r.priceBtn.disabled = cost === null || p.currencies.coins < cost;
    }
  };

  const el = menuScreen(
    host,
    "shop",
    "Mercado",
    wallet,
    mountItem.row,
    keyItem.row,
    h("h2", { text: "Duração dos poderes" }),
    h("p", { class: "note", text: "Melhorias valem nas corridas livres. Corrida do Dia, desafio e torneios as ignoram, para todos correrem em pé de igualdade." }),
    ...upgradeRows.map((r) => r.row),
    button(host, "to-arsenal", "Equipamentos, personagens e montarias → Arsenal", () => host.goto("arsenal"), "btn secondary"),
  );
  return { el, show: refresh, hide() {} };
});

// ------------------------------------------------------------------ book of champions

const METRICS: Array<[Metric, string, string]> = [
  ["score", "Pontos", ""],
  ["distance", "Distância", " m"],
  ["coins", "Moedas", ""],
  ["combo", "Combo", ""],
  ["clean", "Sem colisão", " m"],
];
const TOP_ROWS = 10;

registerScreen("leaderboard", (host) => {
  let boardId = "daily";
  let metric: Metric = "score";
  let token = 0;
  const tabs = h("div", { class: "tabs" });
  const metricTabs = h("div", { class: "tabs small" });
  const status = h("div", { class: "status" });
  const list = h("div", { class: "board-list" });
  const foot = h("div", { class: "note" });

  const row = (e: Board["entries"][number], unit: string) => {
    const crest = e.crest ? parseCrest(e.crest) : crestFromId(e.playerId);
    const crestEl = h("span", { class: "lb-crest" });
    crestEl.innerHTML = crestSvg(crest, 26);
    const title = e.title ? findTitle(e.title)?.name : "";
    return h(
      "div",
      { class: `lb-row${e.isMe ? " me" : ""}` },
      h("span", { class: "rank", text: `#${formatInt(e.rank)}` }),
      crestEl,
      h("span", { class: "name" }, h("b", { text: e.name }), title ? h("small", { text: title }) : null),
      h("span", { class: "pts", text: `${formatInt(e.score)}${unit}` }),
    );
  };

  const render = (b: Board) => {
    const unit = METRICS.find(([m]) => m === b.metric)?.[2] ?? "";
    list.textContent = "";
    setText(status, b.entries.length ? "" : "Ninguém correu ainda. O primeiro lugar está livre.");
    const top = b.entries.slice(0, TOP_ROWS);
    for (const e of top) list.append(row(e, unit));
    if (b.me && !top.some((e) => e.isMe)) {
      list.append(h("div", { class: "lb-gap", text: "…" }), row({ ...b.me, name: `${b.me.name} (você)` }, unit));
    } else if (!b.me) {
      list.append(h("div", { class: "lb-gap", text: "Termine uma corrida válida para entrar no livro." }));
    }
    setText(foot, b.provider === "mock" ? "Liga offline: os jogadores reais aparecem quando o servidor estiver ligado." : "");
  };

  const load = () => {
    const t = ++token;
    const now = Date.now();
    const modes = availableModes(now);
    tabs.textContent = "";
    for (const [id, label] of [["daily", "Diário"], ["weekly", "Semanal"], ["season", "Temporada"], ...modes.filter((m) => m.id === "event").map((m) => [m.board, m.name])]) {
      const b = button(host, `tab-${id}`, label, () => {
        boardId = id;
        if (id !== "season") metric = "score";
        load();
      }, "btn secondary tab");
      b.classList.toggle("active", id === boardId);
      tabs.append(b);
    }
    metricTabs.textContent = "";
    metricTabs.hidden = boardId !== "season";
    for (const [m, label] of METRICS) {
      const b = button(host, `metric-${m}`, label, () => {
        metric = m;
        load();
      }, "btn secondary tab");
      b.classList.toggle("active", m === metric);
      metricTabs.append(b);
    }
    const mode = modes.find((m) => m.board === boardId);
    list.textContent = "";
    setText(status, "Consultando o livro…");
    host.online
      .getBoard(boardId, mode?.period ?? "", metric)
      .then((b) => {
        if (t === token) render(b);
      })
      .catch(() => {
        if (t === token) setText(status, "O livro está fora de alcance agora.");
      });
  };

  const el = menuScreen(host, "leaderboard", "Livro dos Campeões", tabs, metricTabs, status, list, foot);
  return { el, show: load, hide() {} };
});

function parseCrest(s: string): { bg: number; symbol: number; frame: number; color: number } {
  const [bg, symbol, frame, color] = s.split(".").map((n) => Number(n) || 0);
  return { bg, symbol, frame, color };
}

// ------------------------------------------------------------------ settings

registerScreen("settings", (host) => {
  const toggle = (id: string, label: string, get: () => boolean, set: (v: boolean) => void) => {
    const b = h("button", { class: "btn toggle", attrs: { "data-id": id, type: "button" } });
    const paint = () => {
      const on = get();
      setText(b, on ? "Sim" : "Não");
      b.classList.toggle("on", on);
    };
    b.addEventListener("click", () => {
      set(!get());
      host.bus.emit("ui:click", { id });
      paint();
    });
    return { row: h("div", { class: "setting" }, h("span", { text: label }), b), paint };
  };

  const sound = toggle("sound", "Som", () => !host.store.get().settings.muted, (v) => host.store.update((p) => (p.settings.muted = !v)));
  const motion = toggle("reduced-motion", "Reduzir movimento", () => host.store.get().settings.reducedMotion, (v) => host.store.update((p) => (p.settings.reducedMotion = v)));
  const analytics = toggle("analytics", "Métricas de equilíbrio", () => host.store.get().settings.analytics, (v) => host.store.update((p) => (p.settings.analytics = v)));
  const volume = h("input", { class: "interactive", attrs: { type: "range", min: "0", max: "100", step: "5", "data-id": "sfx-volume", "aria-label": "Volume dos efeitos" } });
  volume.addEventListener("input", () => host.store.update((p) => (p.settings.sfx = Number(volume.value) / 100)));
  volume.addEventListener("change", () => host.bus.emit("ui:click", { id: "sfx-volume" }));
  const music = h("input", { class: "interactive", attrs: { type: "range", min: "0", max: "100", step: "5", "data-id": "music-volume", "aria-label": "Volume da música" } });
  music.addEventListener("input", () => host.store.update((p) => (p.settings.music = Number(music.value) / 100)));

  // account: the recovery code is the only way back into this account on a new device
  const code = h("code", { class: "recovery" });
  const recoverInput = h("input", { class: "interactive", attrs: { type: "text", placeholder: "XXXXX-XXXXX-XXXXX", "data-id": "recover-code", "aria-label": "Código de recuperação" } });
  const recoverNote = h("small", { class: "note" });
  const recoverBtn = button(host, "recover", "Recuperar conta", () => {
    setText(recoverNote, "Verificando…");
    host.recover(recoverInput.value).then((ok) => setText(recoverNote, ok ? "Conta recuperada. Reabra o jogo para ver seu nome." : "Código não reconhecido (ou sem conexão)."));
  }, "btn secondary");

  let armed = 0;
  const reset = h("button", { class: "btn danger", text: "Apagar progresso", attrs: { "data-id": "reset-progress", type: "button" } });
  reset.addEventListener("click", () => {
    host.bus.emit("ui:click", { id: "reset-progress" });
    if (Date.now() - armed < 3000) {
      host.store.reset();
      armed = 0;
      setText(reset, "Progresso apagado");
      paintAll();
      return;
    }
    armed = Date.now();
    setText(reset, "Toque de novo para confirmar");
  });

  const controls = h(
    "div",
    { class: "controls" },
    h("div", { text: "Toque: deslize para os lados para trocar de pista, para cima para saltar, para baixo para rolar. Toque duas vezes para montar." }),
    h("div", { text: `Teclado: ${host.brand.copy.keyboardHint} · E montaria · Esc pausa` }),
  );

  const paintAll = () => {
    sound.paint();
    motion.paint();
    analytics.paint();
    volume.value = String(Math.round(host.store.get().settings.sfx * 100));
    music.value = String(Math.round(host.store.get().settings.music * 100));
    const c = host.recoveryCode();
    setText(code, c ?? "Aparece depois da sua primeira corrida online.");
  };

  const el = menuScreen(
    host,
    "settings",
    "Ajustes",
    sound.row,
    h("div", { class: "setting" }, h("span", { text: "Efeitos" }), volume),
    h("div", { class: "setting" }, h("span", { text: "Música" }), music),
    motion.row,
    analytics.row,
    controls,
    h("h2", { text: "Conta" }),
    h("p", { class: "note", text: "Guarde este código: ele recupera sua conta em outro aparelho." }),
    code,
    recoverInput,
    recoverBtn,
    recoverNote,
    reset,
  );
  return {
    el,
    show() {
      armed = 0;
      setText(reset, "Apagar progresso");
      setText(recoverNote, "");
      paintAll();
    },
    hide() {},
  };
});
