/**
 * Character and mount catalog: each item is a manifest model id, so a skin is just a new manifest
 * entry (placeholder silhouette or a real model). Pure functions over Profile.
 *
 * A "mount" is what the runner rides to shrug off one crash — a runic shield, a barrel, a ghost
 * horse. Mechanically it is one charge spent per ride (see game/hoverboard); cosmetically it is the
 * biggest personality slot in the game, which is why it has its own catalog.
 *
 * Items earned from the season track or a bounty still carry a price: earning one is a shortcut,
 * not the only road, so a player who missed a week can still buy it.
 */
import type { Profile } from "../core/store";

export type CatalogKind = "character" | "mount";
export type Currency = "coins" | "keys";

export interface CatalogItem {
  /** Manifest id of the model. */
  id: string;
  name: string;
  price: number;
  currency: Currency;
  /** Swatch colour for the shop. */
  color: string;
  /** One line of flavour for the arsenal. */
  note?: string;
}

export const CHARACTERS: readonly CatalogItem[] = [
  { id: "char.runner.default", name: "Camponês", price: 0, currency: "coins", color: "#9a6b3c", note: "Começou o dia colhendo nabos." },
  { id: "char.runner.knight", name: "Cavaleiro", price: 4000, currency: "coins", color: "#8c99a8", note: "Armadura emprestada, honra própria." },
  { id: "char.runner.archer", name: "Arqueira", price: 4000, currency: "coins", color: "#4f6b3a", note: "Nunca erra. Quase nunca." },
  { id: "char.runner.rogue", name: "Ladino", price: 6000, currency: "coins", color: "#3a3f4a", note: "A bolsa do cobrador sumiu sozinha." },
  { id: "char.runner.bard", name: "Bardo", price: 8000, currency: "coins", color: "#b5603a", note: "Vai transformar esta fuga em canção." },
  { id: "char.runner.mage", name: "Mago", price: 9000, currency: "coins", color: "#4a3f7a", note: "Sabia que ia dar errado." },
  { id: "char.runner.barbarian", name: "Bárbaro", price: 12000, currency: "coins", color: "#8a5a3a", note: "Corre porque se irritou." },
  { id: "char.runner.alchemist", name: "Alquimista", price: 15000, currency: "coins", color: "#2f7a6b", note: "A explosão foi planejada." },
  { id: "char.runner.monk", name: "Monge", price: 20, currency: "keys", color: "#b58a3a", note: "Silêncio, exceto pelos passos." },
  { id: "char.runner.mercenary", name: "Mercenária", price: 25, currency: "keys", color: "#6b6b72", note: "Cobra caro para ser perseguida." },
  { id: "char.runner.royal", name: "Herdeira Rubra", price: 11000, currency: "coins", color: "#7b3041", note: "Foge da coroa, mas não do estilo." },
];

export const MOUNTS: readonly CatalogItem[] = [
  { id: "mount.shield", name: "Escudo Rúnico", price: 0, currency: "coins", color: "#6b7a8f", note: "Desce a ladeira melhor do que apara golpes." },
  { id: "mount.barrel", name: "Barril", price: 2500, currency: "coins", color: "#8a5a30", note: "Estava cheio. Agora não está." },
  { id: "mount.carpet", name: "Tapete Mágico", price: 5000, currency: "coins", color: "#8a3a5a", note: "Herança da avó do mago." },
  { id: "mount.minecart", name: "Carrinho de Mina", price: 7000, currency: "coins", color: "#6b5236", note: "Sem trilho, sem freio, sem problema." },
  { id: "mount.boar", name: "Javali", price: 9000, currency: "coins", color: "#4a3a2f", note: "Não foi domado, só convencido." },
  { id: "mount.wolf", name: "Lobo", price: 12000, currency: "coins", color: "#5a5f66", note: "Corre pelo esporte." },
  { id: "mount.ghosthorse", name: "Cavalo Fantasma", price: 20, currency: "keys", color: "#9fd8ff", note: "Não come, não dorme, não para." },
  { id: "mount.broom", name: "Vassoura", price: 15, currency: "keys", color: "#a8863f", note: "Da bruxa que não quis emprestar." },
  { id: "mount.dragonling", name: "Dragãozinho", price: 30, currency: "keys", color: "#3f7a4a", note: "Ainda não voa. Já queima." },
];

export const DEFAULT_CHARACTER = CHARACTERS[0].id;
export const DEFAULT_MOUNT = MOUNTS[0].id;

export function catalog(kind: CatalogKind): readonly CatalogItem[] {
  return kind === "character" ? CHARACTERS : MOUNTS;
}

export function findItem(kind: CatalogKind, id: string): CatalogItem | undefined {
  return catalog(kind).find((i) => i.id === id);
}

const ownedList = (p: Readonly<Profile>, kind: CatalogKind): readonly string[] => (kind === "character" ? p.owned.characters : p.owned.mounts);

export function owns(p: Readonly<Profile>, kind: CatalogKind, id: string): boolean {
  const item = findItem(kind, id);
  return !!item && (item.price === 0 || ownedList(p, kind).includes(id));
}

/** Equipped item id, falling back to the default when the stored id is unknown or not owned. */
export function equippedId(p: Readonly<Profile>, kind: CatalogKind): string {
  const id = kind === "character" ? p.equipped.character : p.equipped.mount;
  return id && owns(p, kind, id) ? id : kind === "character" ? DEFAULT_CHARACTER : DEFAULT_MOUNT;
}

/** Buys an item (spending coins or keys). Mutates `p`; false when unknown, owned or unaffordable. */
export function buyItem(p: Profile, kind: CatalogKind, id: string): boolean {
  const item = findItem(kind, id);
  if (!item || owns(p, kind, id)) return false;
  if (p.currencies[item.currency] < item.price) return false;
  p.currencies[item.currency] -= item.price;
  (kind === "character" ? p.owned.characters : p.owned.mounts).push(id);
  return true;
}

/** Grants an item without spending anything (season track, streak, bounty). */
export function grantItem(p: Profile, kind: CatalogKind, id: string): boolean {
  const item = findItem(kind, id);
  if (!item || owns(p, kind, id)) return false;
  (kind === "character" ? p.owned.characters : p.owned.mounts).push(id);
  return true;
}

export function equipItem(p: Profile, kind: CatalogKind, id: string): boolean {
  if (!owns(p, kind, id)) return false;
  if (kind === "character") p.equipped.character = id;
  else p.equipped.mount = id;
  return true;
}
