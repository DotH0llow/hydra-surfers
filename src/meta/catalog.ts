/**
 * Character and hoverboard catalog (piece C5): each item is a manifest model id, so a skin is just a
 * new manifest entry (placeholder colour or a real model). Pure functions over Profile.
 */
import type { Profile } from "../core/store";

export type CatalogKind = "character" | "board";
export type Currency = "coins" | "keys";

export interface CatalogItem {
  /** Manifest id of the model. */
  id: string;
  name: string;
  price: number;
  currency: Currency;
  /** Swatch colour for the shop. */
  color: string;
}

export const CHARACTERS: readonly CatalogItem[] = [
  { id: "char.runner.default", name: "Dash", price: 0, currency: "coins", color: "#ff7a1a" },
  { id: "char.runner.spark", name: "Spark", price: 6000, currency: "coins", color: "#2fc4b2" },
  { id: "char.runner.nova", name: "Nova", price: 25000, currency: "coins", color: "#b57bff" },
  { id: "char.runner.ember", name: "Ember", price: 30, currency: "keys", color: "#e5484d" },
];

export const BOARDS: readonly CatalogItem[] = [
  { id: "gear.hoverboard", name: "Classic", price: 0, currency: "coins", color: "#2fc4b2" },
  { id: "gear.hoverboard.flame", name: "Flame", price: 4000, currency: "coins", color: "#ff7a1a" },
  { id: "gear.hoverboard.frost", name: "Frost", price: 12000, currency: "coins", color: "#7fd1ff" },
  { id: "gear.hoverboard.royal", name: "Royal", price: 20, currency: "keys", color: "#b57bff" },
];

export const DEFAULT_CHARACTER = CHARACTERS[0].id;
export const DEFAULT_BOARD = BOARDS[0].id;

export function catalog(kind: CatalogKind): readonly CatalogItem[] {
  return kind === "character" ? CHARACTERS : BOARDS;
}

export function findItem(kind: CatalogKind, id: string): CatalogItem | undefined {
  return catalog(kind).find((i) => i.id === id);
}

const ownedList = (p: Readonly<Profile>, kind: CatalogKind): readonly string[] => (kind === "character" ? p.owned.characters : p.owned.boards);

export function owns(p: Readonly<Profile>, kind: CatalogKind, id: string): boolean {
  const item = findItem(kind, id);
  return !!item && (item.price === 0 || ownedList(p, kind).includes(id));
}

/** Equipped item id, falling back to the default when the stored id is unknown or not owned. */
export function equippedId(p: Readonly<Profile>, kind: CatalogKind): string {
  const id = kind === "character" ? p.equipped.character : p.equipped.board;
  return id && owns(p, kind, id) ? id : kind === "character" ? DEFAULT_CHARACTER : DEFAULT_BOARD;
}

/** Buys an item (spending coins or keys). Mutates `p`; false when unknown, owned or unaffordable. */
export function buyItem(p: Profile, kind: CatalogKind, id: string): boolean {
  const item = findItem(kind, id);
  if (!item || owns(p, kind, id)) return false;
  if (p.currencies[item.currency] < item.price) return false;
  p.currencies[item.currency] -= item.price;
  (kind === "character" ? p.owned.characters : p.owned.boards).push(id);
  return true;
}

export function equipItem(p: Profile, kind: CatalogKind, id: string): boolean {
  if (!owns(p, kind, id)) return false;
  if (kind === "character") p.equipped.character = id;
  else p.equipped.board = id;
  return true;
}
