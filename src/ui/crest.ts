/**
 * Coats of arms, drawn procedurally as SVG from four indices (field, charge, border, colours).
 *
 * No uploads and no art per player: 6 fields x 12 charges x 4 borders x 8 palettes is a few
 * thousand distinct shields, which is plenty to tell 40 people apart on a leaderboard. Some parts
 * are locked behind the season track and achievements (`unlock` = a crest part id the profile must
 * own), which gives cosmetic rewards something to show off on every board.
 */
import type { Crest, Profile } from "../core/store";

interface Part {
  name: string;
  /** Crest part id required to use it (see Profile.owned.crestParts); undefined = free. */
  unlock?: string;
}

interface FieldPart extends Part {
  /** SVG for the second tincture over a field already filled with the first. */
  svg: string;
}

interface ChargePart extends Part {
  /** SVG path(s) drawn in the charge colour, centred on (50, 48). */
  svg: string;
}

interface BorderPart extends Part {
  stroke: string;
  width: number;
  dash?: string;
}

const SHIELD = "M12 8 H88 V48 C88 76 50 94 50 94 C50 94 12 76 12 48 Z";

export const FIELDS: readonly FieldPart[] = [
  { name: "Liso", svg: "" },
  { name: "Partido", svg: '<rect x="50" y="0" width="50" height="100"/>' },
  { name: "Cortado", svg: '<rect x="0" y="48" width="100" height="52"/>' },
  { name: "Esquartelado", svg: '<rect x="50" y="0" width="50" height="48"/><rect x="0" y="48" width="50" height="52"/>' },
  { name: "Banda", svg: '<polygon points="0,20 20,0 100,80 80,100"/>' },
  { name: "Asna", svg: '<polygon points="10,80 50,34 90,80 90,94 50,50 10,94"/>' },
];

export const CHARGES: readonly ChargePart[] = [
  { name: "Nenhum", svg: "" },
  { name: "Estrela", svg: '<polygon points="50,28 55,43 71,43 58,52 63,67 50,58 37,67 42,52 29,43 45,43"/>' },
  { name: "Cruz", svg: '<rect x="44" y="26" width="12" height="46"/><rect x="30" y="40" width="40" height="12"/>' },
  { name: "Coroa", svg: '<polygon points="30,62 30,38 40,50 50,34 60,50 70,38 70,62"/><rect x="30" y="62" width="40" height="7"/>' },
  { name: "Torre", svg: '<rect x="37" y="36" width="26" height="34"/><rect x="33" y="28" width="7" height="10"/><rect x="46" y="28" width="8" height="10"/><rect x="60" y="28" width="7" height="10"/>' },
  { name: "Chave", svg: '<circle cx="50" cy="34" r="8" fill="none" stroke-width="5" stroke="currentColor"/><rect x="47" y="41" width="6" height="30"/><rect x="53" y="60" width="9" height="5"/><rect x="53" y="52" width="7" height="5"/>' },
  { name: "Lua", svg: '<path d="M58 28 A22 22 0 1 0 58 70 A17 17 0 1 1 58 28 Z"/>' },
  { name: "Sol", svg: '<circle cx="50" cy="48" r="11"/><g stroke="currentColor" stroke-width="4"><line x1="50" y1="26" x2="50" y2="32"/><line x1="50" y1="64" x2="50" y2="70"/><line x1="28" y1="48" x2="34" y2="48"/><line x1="66" y1="48" x2="72" y2="48"/><line x1="35" y1="33" x2="39" y2="37"/><line x1="61" y1="59" x2="65" y2="63"/><line x1="61" y1="37" x2="65" y2="33"/><line x1="35" y1="63" x2="39" y2="59"/></g>' },
  { name: "Flor", svg: '<ellipse cx="50" cy="38" rx="6" ry="12"/><ellipse cx="39" cy="50" rx="11" ry="6"/><ellipse cx="61" cy="50" rx="11" ry="6"/><rect x="47" y="48" width="6" height="22"/>' },
  { name: "Espada", unlock: "crest.symbol.sword", svg: '<polygon points="50,22 55,30 55,58 45,58 45,30"/><rect x="36" y="58" width="28" height="5"/><rect x="47" y="63" width="6" height="10"/>' },
  { name: "Corvo", unlock: "crest.symbol.raven", svg: '<path d="M30 56 C38 40 52 36 60 40 L72 34 L66 44 C68 54 60 64 46 64 L36 72 L40 62 Z"/>' },
  { name: "Dragão", unlock: "crest.symbol.dragon", svg: '<path d="M28 62 C30 44 44 36 56 42 L64 30 L66 42 L76 40 L68 50 C70 62 58 70 46 66 L36 72 Z"/>' },
];

export const BORDERS: readonly BorderPart[] = [
  { name: "Simples", stroke: "#2a1d12", width: 4 },
  { name: "Corda", unlock: "crest.frame.rope", stroke: "#c8a86a", width: 5, dash: "6 3" },
  { name: "Louros", unlock: "crest.frame.laurel", stroke: "#6b8f4a", width: 6, dash: "2 2" },
  { name: "Ouro", unlock: "crest.frame.gold", stroke: "#e8c25a", width: 7 },
];

/** Field tincture, second tincture, charge colour. */
export const PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ["#8d3b46", "#e8c25a", "#f3e6c8"],
  ["#2f4a7a", "#d8dde6", "#e8c25a"],
  ["#2f6b3f", "#e8c25a", "#f3e6c8"],
  ["#1d1a17", "#b8862b", "#e8c25a"],
  ["#e8c25a", "#8d3b46", "#2a1d12"],
  ["#5a3a7a", "#d8dde6", "#e8c25a"],
  ["#d8dde6", "#2f4a7a", "#8d3b46"],
  ["#7a4a2a", "#e8c25a", "#1d1a17"],
];

function isAllowed(p: Readonly<Profile>, part: Part): boolean {
  return !part.unlock || p.owned.crestParts.includes(part.unlock);
}

/** Whether every part of a crest is available to this profile. */
export function crestAllowed(p: Readonly<Profile>, c: Crest): boolean {
  const f = FIELDS[c.bg];
  const ch = CHARGES[c.symbol];
  const b = BORDERS[c.frame];
  return !!f && !!ch && !!b && !!PALETTES[c.color] && isAllowed(p, f) && isAllowed(p, ch) && isAllowed(p, b);
}

export type CrestPartKind = "bg" | "symbol" | "frame" | "color";

/** Parts of one kind, with whether this profile may use each. */
export function crestOptions(p: Readonly<Profile>, kind: CrestPartKind): Array<{ index: number; name: string; allowed: boolean }> {
  switch (kind) {
    case "bg":
      return FIELDS.map((f, index) => ({ index, name: f.name, allowed: isAllowed(p, f) }));
    case "symbol":
      return CHARGES.map((c, index) => ({ index, name: c.name, allowed: isAllowed(p, c) }));
    case "frame":
      return BORDERS.map((b, index) => ({ index, name: b.name, allowed: isAllowed(p, b) }));
    default:
      return PALETTES.map((_, index) => ({ index, name: `Cores ${index + 1}`, allowed: true }));
  }
}

let uid = 0;

/** Standalone SVG markup for a crest (safe to put in innerHTML: every part is our own constant). */
export function crestSvg(c: Crest, size = 48): string {
  const field = FIELDS[c.bg] ?? FIELDS[0];
  const charge = CHARGES[c.symbol] ?? CHARGES[0];
  const border = BORDERS[c.frame] ?? BORDERS[0];
  const [t1, t2, cc] = PALETTES[c.color] ?? PALETTES[0];
  const clip = `crest-${uid++}`;
  const dash = border.dash ? ` stroke-dasharray="${border.dash}"` : "";
  return (
    `<svg class="crest" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">` +
    `<defs><clipPath id="${clip}"><path d="${SHIELD}"/></clipPath></defs>` +
    `<g clip-path="url(#${clip})"><rect width="100" height="100" fill="${t1}"/>` +
    `<g fill="${t2}">${field.svg}</g>` +
    `<g fill="${cc}" color="${cc}">${charge.svg}</g></g>` +
    `<path d="${SHIELD}" fill="none" stroke="${border.stroke}" stroke-width="${border.width}"${dash}/>` +
    `</svg>`
  );
}

/** A crest derived from a player id, for other players before they have picked one. */
export function crestFromId(id: string): Crest {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h >>>= 0;
  return {
    bg: h % FIELDS.length,
    symbol: 1 + ((h >>> 4) % 8),
    frame: 0,
    color: (h >>> 9) % PALETTES.length,
  };
}
