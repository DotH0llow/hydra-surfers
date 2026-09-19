/**
 * Titles — the cheapest social system in the game and one of the most effective.
 *
 * A title is pure cosmetics shown next to a name on every board, so it is a way to carry a story
 * ("Caçador de Dragões") into a leaderboard nobody would otherwise read twice. They cost nothing
 * to produce and they give a 30-day season a long tail of things to chase.
 */

export interface TitleDef {
  id: string;
  name: string;
  /** Where it comes from, shown in the profile next to locked ones. */
  how: string;
}

export const TITLES: readonly TitleDef[] = [
  { id: "title.escudeiro", name: "Escudeiro", how: "Nível 6 da temporada" },
  { id: "title.cavaleiro", name: "Cavaleiro", how: "Nível 13 da temporada" },
  { id: "title.mercenario", name: "Mercenário", how: "Nível 21 da temporada" },
  { id: "title.lenda", name: "Lenda da Taverna", how: "Nível 30 da temporada" },
  { id: "title.peregrino", name: "Peregrino", how: "Recompensa da Estrada Longa" },
  { id: "title.foradalei", name: "Fora-da-Lei", how: "Escape da guarda 50 vezes" },
  { id: "title.campeao", name: "Campeão", how: "Termine em 1º na Corrida do Dia" },
  { id: "title.dragao", name: "Caçador de Dragões", how: "Corra 10 km numa só corrida" },
  { id: "title.moedas", name: "Mestre das Moedas", how: "Junte 10.000 moedas no total" },
  { id: "title.imortal", name: "Imortal", how: "3 km sem encostar em nada" },
  { id: "title.rei", name: "Rei da Estrada", how: "15 km numa só corrida" },
  { id: "title.taverneiro", name: "Taverneiro", how: "Complete 50 contratos" },
];

const BY_ID = new Map(TITLES.map((t) => [t.id, t]));

export function findTitle(id: string): TitleDef | undefined {
  return BY_ID.get(id);
}

/** Display name for a title id ("" when none is equipped). */
export function titleName(id: string): string {
  return BY_ID.get(id)?.name ?? "";
}
