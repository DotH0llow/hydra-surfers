/** Menu screens reached from Home: shop (C5), missions (C4), leaderboard (C6) and settings. */
import { activeMissions, multiplierBonus } from "../../meta/missions";
import { buyItem, catalog, equipItem, equippedId, owns, type CatalogKind } from "../../meta/catalog";
import { KEY_PRICE, MAX_UPGRADE_LEVEL, MOUNT_PRICE, UPGRADE_IDS, buyKey, buyMount, buyUpgrade, readUpgrades, upgradeCost, type UpgradeId } from "../../meta/upgrades";
import type { Board, BoardScope } from "../../online/LeaderboardService";
import { h, formatInt, setText } from "../dom";
import { button, chip, progressBar } from "./kit";
import { registerScreen, type ScreenHost } from "./registry";

function menuScreen(host: ScreenHost, name: string, title: string, ...body: Node[]): HTMLElement {
  return h(
    "div",
    { class: "screen overlay menu", attrs: { "data-screen": name } },
    h("div", { class: "panel" }, h("h1", { text: title }), ...body, button(host, "back", host.brand.copy.back, () => host.goto("home"), "btn secondary")),
  );
}

// ------------------------------------------------------------------ shop

const UPGRADE_LABELS: Record<UpgradeId, string> = {
  jetpack: "Jetpack",
  sneakers: "Super sneakers",
  magnet: "Coin magnet",
  multiplier: "2x multiplier",
};

registerScreen("shop", (host) => {
  const coins = chip("coin", "COINS");
  const keys = chip("key", "KEYS");
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

  const mountItem = item("mount", "Montaria", "Absorve uma queda. Toque duas vezes para montar.", MOUNT_PRICE, buyMount);
  const keyItem = item("key", "Key", "Revive after a crash.", KEY_PRICE, buyKey);

  const upgradeRows = UPGRADE_IDS.map((id) => {
    const pips = h("div", { class: "pips" });
    for (let i = 0; i < MAX_UPGRADE_LEVEL; i++) pips.append(h("i"));
    const priceBtn = h("button", { class: "btn buy", text: "", attrs: { "data-id": `upgrade-${id}`, type: "button" } });
    const row = h("div", { class: "shop-row" }, h("div", { class: "shop-info" }, h("b", { text: UPGRADE_LABELS[id] }), pips), priceBtn);
    priceBtn.addEventListener("click", () => buy(`upgrade-${id}`, (p) => buyUpgrade(p, id), row));
    return { id, row, pips, priceBtn };
  });

  const catalogRows = (kind: CatalogKind) =>
    catalog(kind).map((item) => {
      const btn = h("button", { class: "btn buy", attrs: { "data-id": `item-${item.id}`, type: "button" } });
      const row = h(
        "div",
        { class: "shop-row" },
        h("div", { class: "shop-item" }, h("i", { class: "swatch", attrs: { style: `background:${item.color}` } }), h("b", { text: item.name })),
        btn,
      );
      btn.addEventListener("click", () => {
        if (owns(host.store.get(), kind, item.id)) buy(`equip-${item.id}`, (p) => equipItem(p, kind, item.id), row);
        else buy(`buy-${item.id}`, (p) => buyItem(p, kind, item.id) && equipItem(p, kind, item.id), row);
      });
      return { kind, item, row, btn };
    });
  const characterRows = catalogRows("character");
  const mountRows = catalogRows("mount");

  const refresh = () => {
    const p = host.store.get();
    for (const r of [...characterRows, ...mountRows]) {
      const owned = owns(p, r.kind, r.item.id);
      const equipped = owned && equippedId(p, r.kind) === r.item.id;
      const price = r.item.currency === "keys" ? `${formatInt(r.item.price)} keys` : formatInt(r.item.price);
      setText(r.btn, equipped ? "Equipped" : owned ? "Equip" : price);
      r.btn.disabled = equipped || (!owned && p.currencies[r.item.currency] < r.item.price);
      r.btn.classList.toggle("owned", owned);
    }
    setText(coins.value, formatInt(p.currencies.coins));
    setText(keys.value, formatInt(p.currencies.keys));
    setText(mounts.value, formatInt(p.currencies.mounts));
    for (const it of [mountItem, keyItem]) it.priceBtn.disabled = p.currencies.coins < it.price;
    const levels = readUpgrades(p);
    for (const r of upgradeRows) {
      const lvl = levels[r.id];
      r.pips.querySelectorAll("i").forEach((pip, i) => pip.classList.toggle("on", i < lvl));
      const cost = upgradeCost(lvl);
      setText(r.priceBtn, cost === null ? "MAX" : formatInt(cost));
      r.priceBtn.disabled = cost === null || p.currencies.coins < cost;
    }
  };

  const el = menuScreen(
    host,
    "shop",
    "Shop",
    wallet,
    mountItem.row,
    keyItem.row,
    h("h2", { text: "Power-up upgrades" }),
    ...upgradeRows.map((r) => r.row),
    h("h2", { text: "Characters" }),
    ...characterRows.map((r) => r.row),
    h("h2", { text: "Montarias" }),
    ...mountRows.map((r) => r.row),
  );
  return { el, show: refresh, hide() {} };
});

// ------------------------------------------------------------------ missions

registerScreen("missions", (host) => {
  const mult = h("div", { class: "mult-line" });
  const list = h("div", { class: "mission-list" });
  const note = h("p", { class: "note", text: "Complete all three missions to raise your score multiplier by one." });
  const el = menuScreen(host, "missions", "Missions", mult, list, note);
  return {
    el,
    show() {
      const p = host.store.get();
      setText(mult, `Score multiplier x${1 + multiplierBonus(p)} · set ${p.missions.set}`);
      list.textContent = "";
      for (const m of activeMissions(p)) {
        const bar = progressBar(m.done ? "done" : "");
        bar.set(m.goal > 0 ? m.progress / m.goal : 1);
        list.append(
          h(
            "div",
            { class: `mission big${m.done ? " done" : ""}` },
            h("div", { class: "mission-top" }, h("span", { text: m.label }), h("span", { class: "mission-num", text: m.done ? "Done" : `${formatInt(m.progress)}/${formatInt(m.goal)}` })),
            bar.el,
          ),
        );
      }
    },
    hide() {},
  };
});

// ------------------------------------------------------------------ leaderboard

const SCOPES: Array<[BoardScope, string]> = [
  ["global", "Global"],
  ["weekly", "Weekly"],
  ["friends", "Friends"],
];
const TOP_ROWS = 8;

function untilText(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return d >= 1 ? `Resets in ${d}d ${h % 24}h` : `Resets in ${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

registerScreen("leaderboard", (host) => {
  let scope: BoardScope = "global";
  let token = 0;
  const tabs = h("div", { class: "tabs" });
  const tabButtons = SCOPES.map(([id, label]) => {
    const b = button(host, `tab-${id}`, label, () => {
      scope = id;
      load();
    }, "btn secondary tab");
    tabs.append(b);
    return [id, b] as const;
  });
  const status = h("div", { class: "status" });
  const list = h("div", { class: "board-list" });
  const foot = h("div", { class: "note" });

  const row = (rank: number, name: string, score: number, me: boolean) =>
    h("div", { class: `lb-row${me ? " me" : ""}` }, h("span", { class: "rank", text: `#${formatInt(rank)}` }), h("span", { class: "name", text: name }), h("span", { class: "pts", text: formatInt(score) }));

  const render = (b: Board) => {
    list.textContent = "";
    setText(status, b.entries.length ? "" : "No scores yet");
    const top = b.entries.slice(0, TOP_ROWS);
    for (const e of top) list.append(row(e.rank, e.name, e.score, !!e.isMe));
    if (b.me && !top.some((e) => e.isMe)) {
      list.append(h("div", { class: "lb-gap", text: "…" }), row(b.me.rank, `${b.me.name} (you)`, b.me.score, true));
    } else if (!b.me) {
      list.append(h("div", { class: "lb-gap", text: "Finish a run to get on the board" }));
    }
    const parts: string[] = [];
    if (b.resetsAt) parts.push(untilText(b.resetsAt - Date.now()));
    if (b.provider === "mock") parts.push("Offline league");
    setText(foot, parts.join(" · "));
  };

  const load = () => {
    const t = ++token;
    for (const [id, b] of tabButtons) b.classList.toggle("active", id === scope);
    list.textContent = "";
    setText(status, "Loading…");
    host.online
      .getBoard(scope)
      .then((b) => {
        if (t === token) render(b);
      })
      .catch(() => {
        if (t === token) setText(status, "Leaderboard unavailable right now");
      });
  };

  const el = menuScreen(host, "leaderboard", "Ranks", tabs, status, list, foot);
  return { el, show: load, hide() {} };
});

// ------------------------------------------------------------------ settings

registerScreen("settings", (host) => {
  const toggle = (id: string, label: string, get: () => boolean, set: (v: boolean) => void) => {
    const b = h("button", { class: "btn toggle", attrs: { "data-id": id, type: "button" } });
    const paint = () => {
      const on = get();
      setText(b, on ? "On" : "Off");
      b.classList.toggle("on", on);
    };
    b.addEventListener("click", () => {
      set(!get());
      host.bus.emit("ui:click", { id });
      paint();
    });
    return { row: h("div", { class: "setting" }, h("span", { text: label }), b), paint };
  };

  const sound = toggle("sound", "Sound", () => !host.store.get().settings.muted, (v) => host.store.update((p) => (p.settings.muted = !v)));
  const motion = toggle("reduced-motion", "Reduced motion", () => host.store.get().settings.reducedMotion, (v) => host.store.update((p) => (p.settings.reducedMotion = v)));
  const volume = h("input", { class: "interactive", attrs: { type: "range", min: "0", max: "100", step: "5", "data-id": "sfx-volume", "aria-label": "Effects volume" } });
  volume.addEventListener("input", () => host.store.update((p) => (p.settings.sfx = Number(volume.value) / 100)));
  volume.addEventListener("change", () => host.bus.emit("ui:click", { id: "sfx-volume" }));
  const music = h("input", { class: "interactive", attrs: { type: "range", min: "0", max: "100", step: "5", "data-id": "music-volume", "aria-label": "Music volume" } });
  music.addEventListener("input", () => host.store.update((p) => (p.settings.music = Number(music.value) / 100)));

  let armed = 0;
  const reset = h("button", { class: "btn danger", text: "Reset progress", attrs: { "data-id": "reset-progress", type: "button" } });
  reset.addEventListener("click", () => {
    host.bus.emit("ui:click", { id: "reset-progress" });
    if (Date.now() - armed < 3000) {
      host.store.reset();
      armed = 0;
      setText(reset, "Progress reset");
      paintAll();
      return;
    }
    armed = Date.now();
    setText(reset, "Tap again to confirm");
  });

  const controls = h(
    "div",
    { class: "controls" },
    h("div", { text: "Touch: swipe left/right to switch lanes, up to jump, down to roll. Double-tap for a hoverboard." }),
    h("div", { text: `Keyboard: ${host.brand.copy.keyboardHint} · E hoverboard · Esc pause` }),
  );

  const paintAll = () => {
    sound.paint();
    motion.paint();
    volume.value = String(Math.round(host.store.get().settings.sfx * 100));
    music.value = String(Math.round(host.store.get().settings.music * 100));
  };

  const el = menuScreen(
    host,
    "settings",
    "Settings",
    sound.row,
    h("div", { class: "setting" }, h("span", { text: "Effects volume" }), volume),
    h("div", { class: "setting" }, h("span", { text: "Music volume" }), music),
    motion.row,
    controls,
    reset,
  );
  return {
    el,
    show() {
      armed = 0;
      setText(reset, "Reset progress");
      paintAll();
    },
    hide() {},
  };
});
