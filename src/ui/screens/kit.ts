/** Small shared UI kit for screens: buttons that emit ui:click, stat chips, progress bars. */
import { h } from "../dom";
import type { ScreenHost } from "./registry";

export function button(host: ScreenHost, id: string, label: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  return h("button", {
    class: cls,
    text: label,
    attrs: { "data-id": id, type: "button" },
    on: {
      click: () => {
        host.bus.emit("ui:click", { id });
        onClick();
      },
    },
  });
}

/** Progress bar; returns the root and a setter (0..1). */
export function progressBar(cls = ""): { el: HTMLElement; set(frac: number): void } {
  const fill = h("div", { class: "fill" });
  const el = h("div", { class: `bar ${cls}`.trim() }, fill);
  return {
    el,
    set(frac: number) {
      fill.style.width = `${(Math.min(1, Math.max(0, frac)) * 100).toFixed(1)}%`;
    },
  };
}

/** "KEY 3"-style currency chip without image assets. */
export function chip(kind: string, label: string): { el: HTMLElement; value: HTMLElement } {
  const value = h("b", { text: "0" });
  const el = h("div", { class: `chip chip-${kind}` }, h("span", { class: "chip-label", text: label }), value);
  return { el, value };
}
