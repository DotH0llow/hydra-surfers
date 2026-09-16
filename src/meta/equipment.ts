/**
 * Equipment: one weapon, one armour and one relic per run.
 *
 * Every item is data — a name, a rarity, where it comes from and a list of `Effect`s over
 * `RunRules`. The arsenal screen generates its description from the effects, so there is no
 * second place where a number can drift.
 *
 * Design rule for this catalogue: **no item is strictly better than another**. Every item that
 * gives something takes something back, and the numbers stay small (5-25%) so a build shifts how
 * a run plays without deciding it. Items never stack into a different game: `clampRules` bounds
 * the totals, and seeded competitive modes normalise the grind-based multipliers separately.
 */
import type { Effect } from "../game/rules";
import { describeEffects, isEffectPositive } from "../game/rules";
import type { Profile } from "../core/store";
import { PRICES } from "../shared/content/season";

export type EquipSlot = "weapon" | "armor" | "relic";
export type Rarity = "common" | "rare" | "epic";

export type ItemSource =
  | { kind: "start" }
  | { kind: "shop"; price: number; currency: "coins" | "keys" }
  | { kind: "season"; level: number }
  | { kind: "achievement"; id: string };

export interface EquipItem {
  id: string;
  slot: EquipSlot;
  name: string;
  /** Flavour line; the mechanical text is generated from `effects`. */
  flavour: string;
  rarity: Rarity;
  source: ItemSource;
  effects: Effect[];
}

export const SLOTS: readonly EquipSlot[] = ["weapon", "armor", "relic"];

export const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: "Arma",
  armor: "Armadura",
  relic: "Relíquia",
};

export const RARITY_LABELS: Record<Rarity, string> = {
  common: "Comum",
  rare: "Raro",
  epic: "Épico",
};

export const EQUIPMENT: readonly EquipItem[] = [
  // ---------------------------------------------------------------- weapons
  {
    id: "weapon.sword",
    slot: "weapon",
    name: "Espada Curta",
    flavour: "Simples, gasta, confiável. Recompensa quem corre rápido.",
    rarity: "common",
    source: { kind: "start" },
    effects: [
      { rule: "highSpeedScoreBonus", op: "add", value: 0.15 },
      { rule: "coinValue", value: 0.92 },
    ],
  },
  {
    id: "weapon.bow",
    slot: "weapon",
    name: "Arco Curto",
    flavour: "Uma flecha bem colocada abre caminho — às vezes.",
    rarity: "rare",
    source: { kind: "season", level: 4 },
    effects: [
      { rule: "breakChance", op: "add", value: 0.3 },
      { rule: "scoreMul", value: 0.95 },
    ],
  },
  {
    id: "weapon.hammer",
    slot: "weapon",
    name: "Martelo de Guerra",
    flavour: "A primeira barricada da estrada nunca sobrevive ao encontro.",
    rarity: "common",
    source: { kind: "shop", price: PRICES.itemCommon, currency: "coins" },
    effects: [
      { rule: "breakLowBarriers", op: "add", value: 1 },
      { rule: "jumpHeightMul", value: 0.94 },
    ],
  },
  {
    id: "weapon.dagger",
    slot: "weapon",
    name: "Adaga do Ladino",
    flavour: "Premia sequências limpas; pune quem hesita.",
    rarity: "rare",
    source: { kind: "shop", price: PRICES.itemRare, currency: "coins" },
    effects: [
      { rule: "perfectStreakBonus", op: "add", value: 1 },
      { rule: "comboWindowMul", value: 0.85 },
    ],
  },
  {
    id: "weapon.staff",
    slot: "weapon",
    name: "Cajado Rúnico",
    flavour: "Estica a magia alheia, mas não foi feito para correr.",
    rarity: "epic",
    source: { kind: "achievement", id: "ach.biomes.all" },
    effects: [
      { rule: "powerupDurationMul", value: 1.18 },
      { rule: "skillScoreMul", value: 0.9 },
    ],
  },

  // ---------------------------------------------------------------- armour
  {
    id: "armor.leather",
    slot: "armor",
    name: "Gibão de Couro",
    flavour: "Leve o bastante para montar por mais tempo.",
    rarity: "common",
    source: { kind: "start" },
    effects: [
      { rule: "mountDurationMul", value: 1.3 },
      { rule: "magnetDurationMul", value: 0.9 },
    ],
  },
  {
    id: "armor.chainmail",
    slot: "armor",
    name: "Cota de Malha",
    flavour: "Absorve o primeiro tropeço da corrida.",
    rarity: "rare",
    source: { kind: "season", level: 11 },
    effects: [
      { rule: "stumbleAbsorbs", op: "add", value: 1 },
      { rule: "airTimeMul", value: 0.96 },
    ],
  },
  {
    id: "armor.plate",
    slot: "armor",
    name: "Armadura Pesada",
    flavour: "Uma queda perdoada. Em troca, a estrada passa mais rápido.",
    rarity: "rare",
    source: { kind: "shop", price: PRICES.itemRare, currency: "coins" },
    effects: [
      { rule: "shieldCharges", op: "add", value: 1 },
      { rule: "speedMul", value: 1.08 },
    ],
  },
  {
    id: "armor.cloak",
    slot: "armor",
    name: "Capa do Viajante",
    flavour: "O amuleto alcança mais longe sob a capa.",
    rarity: "common",
    source: { kind: "shop", price: PRICES.itemCommon, currency: "coins" },
    effects: [
      { rule: "magnetReachMul", value: 1.25 },
      { rule: "magnetDurationMul", value: 1.15 },
      { rule: "griffinDurationMul", value: 0.88 },
    ],
  },
  {
    id: "armor.robes",
    slot: "armor",
    name: "Vestes do Arcano",
    flavour: "Poder abundante, corpo frágil.",
    rarity: "epic",
    source: { kind: "achievement", id: "ach.powerups.all" },
    effects: [
      { rule: "pickupChanceMul", value: 1.35 },
      { rule: "mountDurationMul", value: 0.8 },
    ],
  },

  // ---------------------------------------------------------------- relics
  {
    id: "relic.kingscoin",
    slot: "relic",
    name: "Moeda do Rei",
    flavour: "Toda moeda rende mais — a fama é que rende menos.",
    rarity: "common",
    source: { kind: "start" },
    effects: [
      { rule: "coinValue", value: 1.18 },
      { rule: "scoreMul", value: 0.95 },
    ],
  },
  {
    id: "relic.horseshoe",
    slot: "relic",
    name: "Ferradura Torta",
    flavour: "Uma vez por corrida, a sorte decide que não foi dessa vez.",
    rarity: "rare",
    source: { kind: "season", level: 18 },
    effects: [
      { rule: "luckChance", op: "add", value: 0.25 },
      { rule: "pickupChanceMul", value: 0.9 },
    ],
  },
  {
    id: "relic.griffinfeather",
    slot: "relic",
    name: "Pena de Grifo",
    flavour: "Salto mais alto, queda mais lenta — e mais tempo no ar para errar.",
    rarity: "common",
    source: { kind: "shop", price: PRICES.itemCommon, currency: "coins" },
    effects: [
      { rule: "jumpHeightMul", value: 1.12 },
      { rule: "airTimeMul", value: 1.12 },
      { rule: "comboWindowMul", value: 0.92 },
    ],
  },
  {
    id: "relic.mageeye",
    slot: "relic",
    name: "Olho do Mago",
    flavour: "Mostra os poderes adiante na estrada.",
    rarity: "rare",
    source: { kind: "season", level: 25 },
    effects: [
      { rule: "revealPickups", op: "set", value: 1 },
      { rule: "scoreMul", value: 0.97 },
    ],
  },
  {
    id: "relic.amulet",
    slot: "relic",
    name: "Amuleto Antigo",
    flavour: "Estica toda bênção; a montaria é que não gosta dele.",
    rarity: "rare",
    source: { kind: "shop", price: PRICES.itemRare, currency: "coins" },
    effects: [
      { rule: "powerupDurationMul", value: 1.2 },
      { rule: "mountDurationMul", value: 0.82 },
    ],
  },
];

const BY_ID = new Map(EQUIPMENT.map((i) => [i.id, i]));

export function findEquip(id: string): EquipItem | undefined {
  return BY_ID.get(id);
}

export function itemsForSlot(slot: EquipSlot): EquipItem[] {
  return EQUIPMENT.filter((i) => i.slot === slot);
}

/** Items a player starts with, so every slot has something from the first run. */
export function starterItems(): string[] {
  return EQUIPMENT.filter((i) => i.source.kind === "start").map((i) => i.id);
}

export function ownsEquip(p: Readonly<Profile>, id: string): boolean {
  const item = findEquip(id);
  if (!item) return false;
  return item.source.kind === "start" || p.owned.equipment.includes(id);
}

/** The equipped item for a slot, falling back to nothing when the stored id is unknown/unowned. */
export function equippedItem(p: Readonly<Profile>, slot: EquipSlot): EquipItem | null {
  const id = p.equipped[slot];
  if (!id) return null;
  const item = findEquip(id);
  return item && item.slot === slot && ownsEquip(p, id) ? item : null;
}

/** Every effect the current build contributes to a run. */
export function buildEffects(p: Readonly<Profile>): Effect[] {
  const out: Effect[] = [];
  for (const slot of SLOTS) {
    const item = equippedItem(p, slot);
    if (item) out.push(...item.effects);
  }
  return out;
}

/** Short summary of the equipped build for the HUD and results screen. */
export function buildSummary(p: Readonly<Profile>): string {
  const names = SLOTS.map((s) => equippedItem(p, s)?.name).filter(Boolean);
  return names.length ? names.join(" · ") : "Sem equipamento";
}

/** Generated description lines for an item, split into gains and costs. */
export function itemLines(item: EquipItem): { gains: string[]; costs: string[] } {
  const gains: string[] = [];
  const costs: string[] = [];
  for (const e of item.effects) {
    const text = describeEffects([e])[0];
    if (!text) continue;
    (isEffectPositive(e) ? gains : costs).push(text);
  }
  return { gains, costs };
}

export function equipSlot(p: Profile, slot: EquipSlot, id: string): boolean {
  if (id === "") {
    p.equipped[slot] = "";
    return true;
  }
  const item = findEquip(id);
  if (!item || item.slot !== slot || !ownsEquip(p, id)) return false;
  p.equipped[slot] = id;
  return true;
}

/** Buys a shop item with its own currency. Mutates `p` (call inside ProfileStore.update). */
export function buyEquip(p: Profile, id: string): boolean {
  const item = findEquip(id);
  if (!item || ownsEquip(p, id) || item.source.kind !== "shop") return false;
  if (p.currencies[item.source.currency] < item.source.price) return false;
  p.currencies[item.source.currency] -= item.source.price;
  p.owned.equipment.push(id);
  return true;
}

/** Grants an item from a season level or achievement (no currency involved). */
export function grantEquip(p: Profile, id: string): boolean {
  if (!findEquip(id) || p.owned.equipment.includes(id)) return false;
  p.owned.equipment.push(id);
  return true;
}
