/** Keyboard → actions. Arrows/WASD move, Space/Up/W jump, Down/S/Shift roll, Esc/P pause, Enter tap, E hoverboard. */
import type { Action } from "./actions";
import type { ActionSink } from "./SwipeRecognizer";

export const KEY_BINDINGS: Readonly<Record<string, Action>> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "jump",
  KeyW: "jump",
  Space: "jump",
  ArrowDown: "roll",
  KeyS: "roll",
  ShiftLeft: "roll",
  ShiftRight: "roll",
  Escape: "pause",
  KeyP: "pause",
  Enter: "tap",
  NumpadEnter: "tap",
  KeyE: "hoverboard",
};

export class Keyboard {
  constructor(
    private readonly target: Window,
    private readonly sink: ActionSink,
  ) {
    target.addEventListener("keydown", this.onKey);
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.onKey);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = KEY_BINDINGS[e.code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
    this.sink(action, "keyboard");
  };
}
