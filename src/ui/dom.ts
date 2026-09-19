/** Tiny DOM helper for the UI layer. */

export interface HProps {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: HProps = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) for (const k of Object.keys(props.attrs)) el.setAttribute(k, props.attrs[k]);
  if (props.on) for (const k of Object.keys(props.on) as Array<keyof HTMLElementEventMap>) el.addEventListener(k, props.on[k]!);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** Sets textContent only when it changed (keeps HUD updates cheap). */
export function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export function formatInt(n: number): string {
  return Math.floor(n).toLocaleString("pt-BR");
}

/** "reinicia em 5h 12m" / "reinicia em 2d 4h" for a countdown in ms. */
export function untilText(ms: number): string {
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  const days = Math.floor(hours / 24);
  return days >= 1 ? `reinicia em ${days}d ${hours % 24}h` : `reinicia em ${hours}h ${Math.max(0, Math.floor((ms % 3_600_000) / 60_000))}m`;
}
