/**
 * What changed on the boards since the player last looked ("Marina passou você", "você caiu para
 * #6"). The profile keeps, per board, the player's rank and the players just below; whoever is
 * above now but was below then has overtaken them. Pure functions: the App fetches the boards.
 */
import type { Board } from "../online/LeaderboardService";

export interface RankSnapshot {
  rank: number;
  /** Player ids just below, closest first. */
  below: string[];
}

/** How many players below are remembered (enough for a day of a 40-player group). */
const BELOW = 6;

export function rankSnapshot(board: Board): RankSnapshot | null {
  const me = board.me;
  if (!me) return null;
  const below = board.entries.filter((e) => e.rank > me.rank).slice(0, BELOW).map((e) => e.playerId);
  return { rank: me.rank, below };
}

/** One line about what happened since `last`, or null when nothing got worse. */
export function rankNews(where: string, board: Board, last: RankSnapshot | undefined): string | null {
  const me = board.me;
  if (!me || !last) return null;
  const passedBy = board.entries.filter((e) => e.rank < me.rank && last.below.includes(e.playerId)).map((e) => e.name);
  if (passedBy.length > 0) {
    const who = passedBy.length === 1 ? passedBy[0] : `${passedBy.slice(0, -1).join(", ")} e ${passedBy[passedBy.length - 1]}`;
    return `${who} ${passedBy.length === 1 ? "passou" : "passaram"} você ${where}. Agora você é #${me.rank}.`;
  }
  if (me.rank > last.rank) return `Você caiu de #${last.rank} para #${me.rank} ${where}.`;
  return null;
}

/** The rival line: the leader's boast, or how far the player above is. */
export function rivalText(where: string, board: Board, unit = "pontos"): string | null {
  const me = board.me;
  if (!me) return null;
  if (me.rank === 1) return `Você lidera ${where}. Todos estão atrás de você.`;
  const above = board.entries.find((e) => e.rank === me.rank - 1);
  if (!above) return `Você é #${me.rank} ${where}.`;
  return `#${me.rank} ${where} · ${(above.score - me.score).toLocaleString("pt-BR")} ${unit} atrás de ${above.name}`;
}
