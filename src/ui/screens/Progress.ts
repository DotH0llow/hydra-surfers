/**
 * Progress screens reached from the tavern: the contract board, the arsenal (build, characters,
 * mounts), the player's crest and records, and the season track.
 *
 * Every mutation goes through the pure meta functions inside `store.update`, the same way the shop
 * already did, so these screens hold no rules of their own.
 */
import { HOUSES, HOUSE_TOP_N, houseById } from "../../shared/content/season";
import { SEASON, activeBounty, seasonLevel } from "../../shared/content/season";
import { dayIndex, dayKey } from "../../shared/calendar";
import { ACHIEVEMENTS, achievementProgress, isUnlocked } from "../../meta/achievements";
import { buyItem, catalog, equipItem, equippedId, owns, type CatalogKind } from "../../meta/catalog";
import { activeContracts, claimContract, pruneContracts, type ActiveContract } from "../../meta/contracts";
import {
  EQUIPMENT,
  RARITY_LABELS,
  SLOTS,
  SLOT_LABELS,
  buyEquip,
  equipSlot,
  equippedItem,
  itemLines,
  ownsEquip,
  type EquipItem,
} from "../../meta/equipment";
import { activeMissions, multiplierBonus } from "../../meta/missions";
import { accountLevel } from "../../meta/progression";
import { describeReward, grantReward } from "../../meta/rewards";
import { TITLES } from "../../meta/titles";
import { crestAllowed, crestOptions, crestSvg, type CrestPartKind } from "../crest";
import { h, formatInt, setText } from "../dom";
import { button, progressBar } from "./kit";
import { registerScreen, type ScreenHost } from "./registry";

function menu(host: ScreenHost, name: string, title: string, ...body: Node[]): HTMLElement {
  return h(
    "div",
    { class: "screen overlay menu", attrs: { "data-screen": name } },
    h("div", { class: "panel" }, h("h1", { text: title }), ...body, button(host, "back", host.brand.copy.back, () => host.goto("home"), "btn secondary")),
  );
}

// ---------------------------------------------------------------------------- contracts

function contractRow(host: ScreenHost, c: ActiveContract, onClaim: () => void): HTMLElement {
  const bar = progressBar(c.done ? "done" : "");
  bar.set(c.goal > 0 ? c.progress / c.goal : 1);
  const right = c.claimed
    ? h("span", { class: "mission-num", text: "Recebido" })
    : c.done
      ? button(host, `claim-${c.key}`, `Receber ${describeReward(c.reward)}`, onClaim, "btn buy")
      : h("span", { class: "mission-num", text: `${formatInt(c.progress)}/${formatInt(c.goal)}` });
  return h(
    "div",
    { class: `mission big${c.done ? " done" : ""}${c.claimed ? " claimed" : ""}` },
    h("div", { class: "mission-top" }, h("span", { text: c.label }), right),
    bar.el,
    c.done && !c.claimed ? null : h("small", { class: "reward-line", text: `Recompensa: ${describeReward(c.reward)} + XP` }),
  );
}

const contractsScreen = (host: ScreenHost) => {
  const list = h("div", { class: "mission-list" });
  const note = h("p", { class: "note", text: "Todo o reino recebe os mesmos contratos. Os diários ficam abertos por três dias." });
  const el = menu(host, "contracts", "Quadro de Contratos", list, note);
  const render = () => {
    const now = Date.now();
    host.store.update((p) => pruneContracts(p, now));
    const p = host.store.get();
    const all = activeContracts(p, now);
    const todayKey = dayKey(now);
    list.textContent = "";
    const section = (label: string, items: ActiveContract[]) => {
      if (!items.length) return;
      list.append(h("h2", { text: label }));
      for (const c of items) {
        list.append(
          contractRow(host, c, () => {
            host.store.update((q) => {
              const claim = claimContract(q, c.key, Date.now());
              if (claim) grantReward(q, claim.reward);
            });
            render();
          }),
        );
      }
    };
    section("Hoje", all.filter((c) => c.scope === "daily" && c.period === todayKey));
    // earlier days stay open for catch-up; claimed ones are no longer interesting
    section("Dias anteriores", all.filter((c) => c.scope === "daily" && c.period !== todayKey && !c.claimed));
    section("Semana", all.filter((c) => c.scope === "weekly"));
    // the permanent guild set and the score multiplier it raises
    list.append(h("h2", { text: `Guilda · multiplicador x${1 + multiplierBonus(p)}` }));
    for (const m of activeMissions(p)) {
      const bar = progressBar(m.done ? "done" : "");
      bar.set(m.goal > 0 ? m.progress / m.goal : 1);
      list.append(
        h(
          "div",
          { class: `mission big${m.done ? " done" : ""}` },
          h("div", { class: "mission-top" }, h("span", { text: m.label }), h("span", { class: "mission-num", text: m.done ? "Feito" : `${formatInt(m.progress)}/${formatInt(m.goal)}` })),
          bar.el,
        ),
      );
    }
  };
  return { el, show: render, hide() {} };
};

registerScreen("contracts", contractsScreen);
registerScreen("missions", contractsScreen);

// ---------------------------------------------------------------------------- arsenal

function sourceText(item: EquipItem): string {
  switch (item.source.kind) {
    case "start":
      return "Inicial";
    case "shop":
      return item.source.currency === "keys" ? `${formatInt(item.source.price)} chaves` : formatInt(item.source.price);
    case "season":
      return `Nível ${item.source.level} da temporada`;
    case "achievement":
      return "Conquista";
  }
}

registerScreen("arsenal", (host) => {
  let tab: "gear" | CatalogKind = "gear";
  const tabs = h("div", { class: "tabs" });
  const body = h("div", { class: "arsenal-body" });
  const tabBtns = (
    [
      ["gear", "Equipamento"],
      ["character", "Personagens"],
      ["mount", "Montarias"],
    ] as const
  ).map(([id, label]) => {
    const b = button(host, `tab-${id}`, label, () => {
      tab = id;
      render();
    }, "btn secondary tab");
    tabs.append(b);
    return [id, b] as const;
  });

  const act = (id: string, fn: Parameters<typeof host.store.update>[0]) => {
    host.bus.emit("ui:click", { id });
    host.store.update(fn);
    render();
  };

  const itemCard = (item: EquipItem) => {
    const p = host.store.get();
    const owned = ownsEquip(p, item.id);
    const equipped = equippedItem(p, item.slot)?.id === item.id;
    const { gains, costs } = itemLines(item);
    let action: HTMLElement;
    if (equipped) action = button(host, `unequip-${item.id}`, "Tirar", () => act(`unequip-${item.id}`, (q) => void equipSlot(q, item.slot, "")), "btn secondary buy");
    else if (owned) action = button(host, `equip-${item.id}`, "Equipar", () => act(`equip-${item.id}`, (q) => void equipSlot(q, item.slot, item.id)), "btn buy owned");
    else if (item.source.kind === "shop") {
      const src = item.source;
      const btn = button(host, `buy-${item.id}`, sourceText(item), () => act(`buy-${item.id}`, (q) => void (buyEquip(q, item.id) && equipSlot(q, item.slot, item.id))), "btn buy");
      btn.disabled = p.currencies[src.currency] < src.price;
      action = btn;
    } else action = h("span", { class: "locked", text: `🔒 ${sourceText(item)}` });
    return h(
      "div",
      { class: `item-card rarity-${item.rarity}${equipped ? " equipped" : ""}` },
      h("div", { class: "item-head" }, h("b", { text: item.name }), h("small", { class: "rarity", text: RARITY_LABELS[item.rarity] })),
      h("small", { class: "flavour", text: item.flavour }),
      h("div", { class: "effects" }, ...gains.map((g) => h("span", { class: "gain", text: g })), ...costs.map((c) => h("span", { class: "cost", text: c }))),
      action,
    );
  };

  const catalogCard = (kind: CatalogKind, id: string) => {
    const p = host.store.get();
    const item = catalog(kind).find((i) => i.id === id)!;
    const owned = owns(p, kind, id);
    const equipped = owned && equippedId(p, kind) === id;
    let action: HTMLElement;
    if (equipped) action = h("span", { class: "mission-num", text: "Em uso" });
    else if (owned) action = button(host, `equip-${id}`, "Usar", () => act(`equip-${id}`, (q) => void equipItem(q, kind, id)), "btn buy owned");
    else {
      const btn = button(host, `buy-${id}`, item.currency === "keys" ? `${item.price} chaves` : formatInt(item.price), () => act(`buy-${id}`, (q) => void (buyItem(q, kind, id) && equipItem(q, kind, id))), "btn buy");
      btn.disabled = p.currencies[item.currency] < item.price;
      action = btn;
    }
    return h(
      "div",
      { class: `item-card${equipped ? " equipped" : ""}` },
      h("div", { class: "item-head" }, h("i", { class: "swatch", attrs: { style: `background:${item.color}` } }), h("b", { text: item.name })),
      item.note ? h("small", { class: "flavour", text: item.note }) : null,
      action,
    );
  };

  function render(): void {
    for (const [id, b] of tabBtns) b.classList.toggle("active", id === tab);
    body.textContent = "";
    if (tab === "gear") {
      body.append(h("p", { class: "note", text: "Uma arma, uma armadura e uma relíquia. Todo item dá algo e cobra algo." }));
      for (const slot of SLOTS) {
        body.append(h("h2", { text: SLOT_LABELS[slot] }));
        for (const item of EQUIPMENT.filter((i) => i.slot === slot)) body.append(itemCard(item));
      }
    } else {
      for (const item of catalog(tab)) body.append(catalogCard(tab, item.id));
    }
  }

  const el = menu(host, "arsenal", "Arsenal", tabs, body);
  return { el, show: render, hide() {} };
});

// ---------------------------------------------------------------------------- profile & crest

registerScreen("profile", (host) => {
  const crestBox = h("div", { class: "crest-big" });
  const nameInput = h("input", { class: "interactive name-input", attrs: { type: "text", maxlength: "16", "data-id": "player-name", "aria-label": "Nome" } });
  const nameNote = h("small", { class: "note" });
  nameInput.addEventListener("change", () => {
    host.renamePlayer(nameInput.value).then((r) => {
      const msg = r.ok
        ? "Nome salvo."
        : r.error === "taken"
          ? "Esse nome já é de outra pessoa."
          : r.error === "offline"
            ? "Sem conexão agora: tente depois."
            : "Use de 3 a 16 letras, números ou espaços.";
      setText(nameNote, msg);
      if (!r.ok) nameInput.value = host.playerName;
    });
  });
  const titleSelect = h("select", { class: "interactive", attrs: { "data-id": "title-select", "aria-label": "Título" } });
  titleSelect.addEventListener("change", () => {
    host.store.update((p) => (p.equipped.title = titleSelect.value));
    host.pushProfile();
  });
  const houseSelect = h("select", { class: "interactive", attrs: { "data-id": "house-select", "aria-label": "Casa" } });
  const houseNote = h("small", { class: "note" });
  houseSelect.addEventListener("change", () => {
    host.store.update((p) => (p.social.faction = houseSelect.value));
    host.pushProfile();
    renderHouseNote();
  });
  const renderHouseNote = () => {
    const house = houseById(host.store.get().social.faction);
    setText(houseNote, house ? `"${house.motto}" Os ${HOUSE_TOP_N} melhores da casa no Desafio Semanal contam para ela.` : "Escolha uma casa para somar pontos por ela no Desafio Semanal.");
  };
  const editor = h("div", { class: "crest-editor" });
  const records = h("div", { class: "records" });
  const achievements = h("div", { class: "achievements" });

  const PARTS: Array<[CrestPartKind, string]> = [
    ["bg", "Campo"],
    ["symbol", "Figura"],
    ["frame", "Borda"],
    ["color", "Cores"],
  ];

  const cycle = (kind: CrestPartKind, dir: number) => {
    const p = host.store.get();
    const options = crestOptions(p, kind).filter((o) => o.allowed);
    const current = p.equipped.crest[kind];
    const i = options.findIndex((o) => o.index === current);
    const next = options[(i + dir + options.length) % options.length];
    const crest = { ...p.equipped.crest, [kind]: next.index };
    if (!crestAllowed(p, crest)) return;
    host.store.update((q) => (q.equipped.crest = crest));
    render();
  };

  function render(): void {
    const p = host.store.get();
    crestBox.innerHTML = crestSvg(p.equipped.crest, 110);
    nameInput.value = host.playerName;
    setText(nameNote, "");

    titleSelect.textContent = "";
    titleSelect.append(h("option", { text: "Sem título", attrs: { value: "" } }));
    for (const t of TITLES) {
      if (!p.owned.titles.includes(t.id)) continue;
      const o = h("option", { text: t.name, attrs: { value: t.id } });
      if (p.equipped.title === t.id) o.setAttribute("selected", "");
      titleSelect.append(o);
    }

    houseSelect.textContent = "";
    houseSelect.append(h("option", { text: "Sem casa", attrs: { value: "" } }));
    for (const house of HOUSES) {
      const o = h("option", { text: house.name, attrs: { value: house.id } });
      if (p.social.faction === house.id) o.setAttribute("selected", "");
      houseSelect.append(o);
    }
    renderHouseNote();

    editor.textContent = "";
    for (const [kind, label] of PARTS) {
      const opts = crestOptions(p, kind);
      const cur = opts.find((o) => o.index === p.equipped.crest[kind]);
      const locked = opts.filter((o) => !o.allowed).length;
      editor.append(
        h(
          "div",
          { class: "crest-row" },
          button(host, `crest-${kind}-prev`, "‹", () => cycle(kind, -1), "btn secondary tiny"),
          h("span", { text: `${label}: ${cur?.name ?? ""}` }),
          button(host, `crest-${kind}-next`, "›", () => cycle(kind, 1), "btn secondary tiny"),
          locked ? h("small", { class: "locked", text: `${locked} bloqueadas` }) : null,
        ),
      );
    }

    const st = p.stats;
    const rows: Array<[string, string]> = [
      ["Nível", String(accountLevel(p.progress.xp))],
      ["Melhor pontuação", formatInt(st.bestScore)],
      ["Maior distância", `${formatInt(st.bestDistance)} m`],
      ["Mais moedas numa corrida", formatInt(st.bestCoinsRun)],
      ["Maior combo", formatInt(st.bestCombo)],
      ["Maior sequência limpa", `${formatInt(st.bestCleanDistance)} m`],
      ["Melhor Corrida do Dia", formatInt(st.bestDailyScore)],
      ["Corridas do Dia", formatInt(st.dailyRuns)],
      ["Maior velocidade", `${Math.round(st.bestSpeed * 3.6)} km/h`],
      ["Corridas", formatInt(st.runs)],
      ["Distância total", `${formatInt(st.totalDistance / 1000)} km`],
      ["Passadas raspando", formatInt(st.nearMisses)],
      ["Esquivas perfeitas", formatInt(st.perfectDodges)],
      ["Contratos cumpridos", formatInt(st.contractsDone)],
      ["Regiões visitadas", `${st.biomesVisited.length}/8`],
    ];
    records.textContent = "";
    for (const [k, v] of rows) records.append(h("div", { class: "row small" }, h("span", { text: k }), h("b", { text: v })));

    const prog = achievementProgress(p);
    achievements.textContent = "";
    achievements.append(h("h2", { text: `Conquistas ${prog.done}/${prog.total}` }), h("small", { class: "note", text: "Toque numa conquista para destacá-la no seu perfil (até 3)." }));
    for (const a of ACHIEVEMENTS) {
      const done = isUnlocked(p, a.id);
      const shown = p.equipped.showcase.includes(a.id);
      const row = h(
        "div",
        { class: `ach${done ? " done interactive" : ""}${shown ? " shown" : ""}`, attrs: done ? { "data-id": `showcase-${a.id}` } : {} },
        h("b", { text: `${shown ? "★ " : done ? "✓ " : ""}${a.name}` }),
        h("small", { text: a.reward ? `${a.desc} · ${describeReward(a.reward)}` : a.desc }),
      );
      if (done) {
        row.addEventListener("click", () => {
          host.bus.emit("ui:click", { id: `showcase-${a.id}` });
          host.store.update((q) => {
            const list = q.equipped.showcase;
            const i = list.indexOf(a.id);
            if (i >= 0) list.splice(i, 1);
            else {
              list.push(a.id);
              if (list.length > 3) list.shift();
            }
          });
          host.pushProfile();
          render();
        });
      }
      achievements.append(row);
    }
  }

  const el = menu(
    host,
    "profile",
    "Brasão",
    h("div", { class: "profile-top" }, crestBox, h("div", { class: "profile-id" }, nameInput, nameNote, titleSelect, houseSelect, houseNote)),
    editor,
    h("h2", { text: "Recordes" }),
    records,
    achievements,
  );
  return { el, show: render, hide() {} };
});

// ---------------------------------------------------------------------------- season

registerScreen("season", (host) => {
  const head = h("div", { class: "season-head" });
  const bar = progressBar("gold");
  const bounty = h("div", { class: "bounty" });
  const track = h("div", { class: "season-track" });

  const el = menu(host, "season", SEASON.name, head, bar.el, bounty, track);
  return {
    el,
    show() {
      const p = host.store.get();
      const xp = p.progress.seasonId === SEASON.id ? p.progress.seasonXp : 0;
      const lvl = seasonLevel(xp);
      setText(head, lvl >= SEASON.levels ? `Nível ${lvl} · temporada completa` : `Nível ${lvl} · ${formatInt(xp % SEASON.xpPerLevel)}/${formatInt(SEASON.xpPerLevel)} XP para o próximo`);
      bar.set(lvl >= SEASON.levels ? 1 : (xp % SEASON.xpPerLevel) / SEASON.xpPerLevel);

      const b = activeBounty(dayIndex(Date.now()));
      bounty.textContent = "";
      bounty.hidden = !b;
      if (b) {
        const line = h("small", { class: "note", text: "Carregando o progresso do reino…" });
        bounty.append(h("b", { text: `Missão do Reino: ${b.name}` }), line);
        host.communityProgress().then((c) => {
          if (!c || c.id !== b.id) setText(line, "Progresso do reino disponível só online.");
          else if (c.value >= b.goal) setText(line, `Cumprida! ${formatInt(c.value)}/${formatInt(b.goal)} · todos recebem ${describeReward(b.reward)} ao voltar à taverna.`);
          else setText(line, `${formatInt(c.value)}/${formatInt(b.goal)} · recompensa para todos: ${describeReward(b.reward)}`);
        });
      }

      track.textContent = "";
      SEASON.track.forEach((reward, i) => {
        const level = i + 1;
        const got = p.progress.claimedLevels.includes(level);
        track.append(h("div", { class: `season-step${got ? " done" : level === lvl + 1 ? " next" : ""}` }, h("b", { text: String(level) }), h("span", { text: describeReward(reward) }), got ? h("i", { text: "✓" }) : null));
      });
    },
    hide() {},
  };
});

