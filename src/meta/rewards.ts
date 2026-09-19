/**
 * Granting a reward, wherever it came from (a contract, a season level, a streak day, an
 * achievement, a community bounty).
 *
 * One function so that "what a reward does" lives in exactly one place, and so the results screen
 * can describe a reward with the same words the shop uses.
 */
import type { Profile } from "../core/store";
import type { Reward } from "../shared/content/season";
import { grantItem } from "./catalog";
import { grantEquip, findEquip } from "./equipment";
import { findTitle } from "./titles";

/** Applies a reward to the profile. Mutates `p` (call inside ProfileStore.update). */
export function grantReward(p: Profile, reward: Reward): void {
  switch (reward.kind) {
    case "coins":
      p.currencies.coins += Math.max(0, Math.floor(reward.amount ?? 0));
      break;
    case "keys":
      p.currencies.keys += Math.max(0, Math.floor(reward.amount ?? 0));
      break;
    case "xp":
      // XP is granted through the progression pipeline so the season cap applies; ignored here.
      break;
    case "item":
      if (reward.id) grantEquip(p, reward.id);
      break;
    case "character":
      if (reward.id) grantItem(p, "character", reward.id);
      break;
    case "mount":
      if (reward.id) grantItem(p, "mount", reward.id);
      break;
    case "title":
      if (reward.id && !p.owned.titles.includes(reward.id)) p.owned.titles.push(reward.id);
      break;
    case "crest":
      if (reward.id && !p.owned.crestParts.includes(reward.id)) p.owned.crestParts.push(reward.id);
      break;
  }
}

/** One short pt-BR line describing a reward, for cards and toasts. */
export function describeReward(reward: Reward): string {
  switch (reward.kind) {
    case "coins":
      return `${formatNumber(reward.amount ?? 0)} moedas`;
    case "keys": {
      const n = reward.amount ?? 0;
      return n === 1 ? "1 chave" : `${n} chaves`;
    }
    case "xp":
      return `${formatNumber(reward.amount ?? 0)} XP`;
    case "item":
      return findEquip(reward.id ?? "")?.name ?? "Equipamento";
    case "character":
      return "Novo personagem";
    case "mount":
      return "Nova montaria";
    case "title":
      return `Título: ${findTitle(reward.id ?? "")?.name ?? reward.id}`;
    case "crest":
      return "Peça de brasão";
    default:
      return "";
  }
}

function formatNumber(n: number): string {
  return Math.floor(n).toLocaleString("pt-BR");
}
