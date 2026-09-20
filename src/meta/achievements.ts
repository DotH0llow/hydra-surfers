/**
 * Achievements — permanent goals that outlive a season.
 *
 * Each one is a predicate over the profile, evaluated after a run, so an achievement never needs
 * its own counter: if the number it wants is not already in `profile.stats`, that is a sign the
 * counter belongs in stats.ts rather than here.
 *
 * Most of them hand out a title. That is deliberate: a title is visible to the other 30 players on
 * every board, which is worth far more in a private league than any amount of currency.
 */
import type { Profile } from "../core/store";
import { dayIndex } from "../shared/calendar";
import { XP, type Reward } from "../shared/content/season";
import { MOUNTS } from "./catalog";

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** True once the profile satisfies it. */
  test(p: Readonly<Profile>): boolean;
  reward?: Reward;
  /** Roughly how hard, for ordering in the UI. */
  tier: 1 | 2 | 3;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: "ach.first", name: "Primeira Fuga", desc: "Complete a primeira corrida", tier: 1, test: (p) => p.stats.runs >= 1, reward: { kind: "coins", amount: 200 } },
  { id: "ach.km1", name: "Um Quilômetro", desc: "1 km numa só corrida", tier: 1, test: (p) => p.stats.bestDistance >= 1000, reward: { kind: "coins", amount: 300 } },
  { id: "ach.km5", name: "Cinco Quilômetros", desc: "5 km numa só corrida", tier: 2, test: (p) => p.stats.bestDistance >= 5000, reward: { kind: "keys", amount: 2 } },
  { id: "ach.km10", name: "Caçador de Dragões", desc: "10 km numa só corrida", tier: 3, test: (p) => p.stats.bestDistance >= 10000, reward: { kind: "title", id: "title.dragao" } },
  { id: "ach.km15", name: "Rei da Estrada", desc: "15 km numa só corrida", tier: 3, test: (p) => p.stats.bestDistance >= 15000, reward: { kind: "title", id: "title.rei" } },
  { id: "ach.coins1k", name: "Bolso Cheio", desc: "Junte 1.000 moedas no total", tier: 1, test: (p) => p.stats.totalCoins >= 1000, reward: { kind: "coins", amount: 250 } },
  { id: "ach.coins10k", name: "Mestre das Moedas", desc: "Junte 10.000 moedas no total", tier: 2, test: (p) => p.stats.totalCoins >= 10000, reward: { kind: "title", id: "title.moedas" } },
  { id: "ach.obstacles100", name: "Desviador", desc: "Desvie de 100 obstáculos", tier: 1, test: (p) => p.stats.obstaclesDodged >= 100, reward: { kind: "coins", amount: 300 } },
  { id: "ach.obstacles1000", name: "Intocável", desc: "Desvie de 1.000 obstáculos", tier: 2, test: (p) => p.stats.obstaclesDodged >= 1000, reward: { kind: "keys", amount: 2 } },
  { id: "ach.clean3k", name: "Imortal", desc: "3 km sem encostar em nada", tier: 3, test: (p) => p.stats.bestCleanDistance >= 3000, reward: { kind: "title", id: "title.imortal" } },
  { id: "ach.combo50", name: "Sequência Perfeita", desc: "Chegue a um combo de 50", tier: 2, test: (p) => p.stats.bestCombo >= 50, reward: { kind: "coins", amount: 600 } },
  { id: "ach.near100", name: "Por um Fio", desc: "Passe raspando 100 vezes", tier: 2, test: (p) => p.stats.nearMisses >= 100, reward: { kind: "coins", amount: 500 } },
  { id: "ach.perfect50", name: "Reflexo Afiado", desc: "50 esquivas perfeitas", tier: 2, test: (p) => p.stats.perfectDodges >= 50, reward: { kind: "keys", amount: 2 } },
  { id: "ach.speed", name: "Vento em Popa", desc: "Alcance a velocidade máxima", tier: 2, test: (p) => p.stats.bestSpeed >= 23.5, reward: { kind: "coins", amount: 400 } },
  { id: "ach.biomes.all", name: "Andarilho do Reino", desc: "Visite todas as oito regiões", tier: 3, test: (p) => p.stats.biomesVisited.length >= 8, reward: { kind: "item", id: "weapon.staff" } },
  { id: "ach.powerups.all", name: "Todo o Arsenal", desc: "Use todos os poderes ao menos uma vez", tier: 3, test: (p) => p.stats.powerupKinds.length >= 6, reward: { kind: "item", id: "armor.robes" } },
  { id: "ach.escapes50", name: "Fora-da-Lei", desc: "Escape da guarda 50 vezes", tier: 2, test: (p) => p.stats.stumbles >= 50, reward: { kind: "title", id: "title.foradalei" } },
  { id: "ach.contracts50", name: "Taverneiro", desc: "Complete 50 contratos", tier: 2, test: (p) => p.stats.contractsDone >= 50, reward: { kind: "title", id: "title.taverneiro" } },
  { id: "ach.daily7", name: "Fiel à Estrada", desc: "Sete dias seguidos de corrida", tier: 2, test: (p) => p.streak.best >= 7, reward: { kind: "keys", amount: 3 } },
  { id: "ach.overtake", name: "Pedra no Sapato", desc: "Passe alguém do grupo num placar", tier: 1, test: (p) => p.stats.overtakes >= 1, reward: { kind: "coins", amount: 300 } },
  { id: "ach.overtake25", name: "Terror do Livro", desc: "Passe 25 vezes alguém do grupo nos placares", tier: 2, test: (p) => p.stats.overtakes >= 25, reward: { kind: "keys", amount: 3 } },
  { id: "ach.daily.first", name: "Campeão", desc: "Termine em 1º na Corrida do Dia", tier: 3, test: (p) => p.stats.dailyWins >= 1, reward: { kind: "title", id: "title.campeao" } },
  { id: "ach.mounts5", name: "Estábulo", desc: "Possua cinco montarias", tier: 2, test: (p) => countOwnedMounts(p) >= 5, reward: { kind: "coins", amount: 800 } },
  { id: "ach.season30", name: "Temporada Completa", desc: "Chegue ao nível 30 da temporada", tier: 3, test: (p) => p.progress.seasonXp >= 30_000, reward: { kind: "crest", id: "crest.frame.gold" } },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function findAchievement(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

/** Free mounts count as owned, same rule the shop uses. */
function countOwnedMounts(p: Readonly<Profile>): number {
  return MOUNTS.filter((m) => m.price === 0 || p.owned.mounts.includes(m.id)).length;
}

export function isUnlocked(p: Readonly<Profile>, id: string): boolean {
  return p.achievements[id] !== undefined;
}

/** XP an achievement is worth (flat: they are milestones, not a grind). */
export const ACHIEVEMENT_XP = XP.achievement;

/**
 * Newly satisfied achievements, recorded on the profile with the day they were earned.
 * Mutates `p` (call inside ProfileStore.update). The caller grants the rewards.
 */
export function checkAchievements(p: Profile, now: number): AchievementDef[] {
  const day = dayIndex(now);
  const unlocked: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achievements[a.id] !== undefined) continue;
    if (!a.test(p)) continue;
    p.achievements[a.id] = day;
    unlocked.push(a);
  }
  return unlocked;
}

/** How many are done, for the profile screen. */
export function achievementProgress(p: Readonly<Profile>): { done: number; total: number } {
  return { done: Object.keys(p.achievements).length, total: ACHIEVEMENTS.length };
}
