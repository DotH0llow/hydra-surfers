/**
 * InputRouter: merges swipe/tap (pointer) and keyboard into abstract actions and emits
 * `input:action` on the bus. `dispatch()` is the single entry point — the debug API uses it too,
 * so scripted input follows exactly the same path as real input.
 */
import type { EventBus } from "../core/events";
import { isAction, type Action, type InputSource } from "./actions";
import { Keyboard } from "./Keyboard";
import { INPUT, SwipeRecognizer } from "./SwipeRecognizer";

const payload = { action: "tap" as Action, source: "debug" as InputSource };

export class InputRouter {
  private readonly swipe: SwipeRecognizer;
  private readonly keyboard: Keyboard;
  private lastTap = -1e9;
  private readonly blockers: Array<[EventTarget, string, EventListener]> = [];

  constructor(
    private readonly el: HTMLElement,
    private readonly bus: EventBus,
  ) {
    this.swipe = new SwipeRecognizer(el, this.dispatch);
    this.keyboard = new Keyboard(window, this.dispatch);
    // no scroll / pinch zoom / double-tap zoom / context menu on the playfield
    const prevent: EventListener = (e) => {
      if (e.cancelable) e.preventDefault();
    };
    this.block(document, "touchmove", prevent);
    this.block(document, "gesturestart", prevent);
    this.block(document, "dblclick", prevent);
    this.block(el, "contextmenu", prevent);
  }

  private block(t: EventTarget, type: string, fn: EventListener): void {
    t.addEventListener(type, fn, { passive: false });
    this.blockers.push([t, type, fn]);
  }

  readonly dispatch = (action: Action, source: InputSource = "debug"): void => {
    if (!isAction(action)) {
      console.warn(`[input] unknown action "${String(action)}"`);
      return;
    }
    payload.action = action;
    payload.source = source;
    this.bus.emit("input:action", payload);
    if (action === "tap" && source !== "keyboard") {
      const now = performance.now();
      if ((now - this.lastTap) / 1000 <= INPUT.doubleTapSeconds) {
        this.lastTap = -1e9;
        payload.action = "hoverboard";
        payload.source = source;
        this.bus.emit("input:action", payload);
      } else {
        this.lastTap = now;
      }
    }
  };

  dispose(): void {
    this.swipe.dispose();
    this.keyboard.dispose();
    for (const [t, type, fn] of this.blockers) t.removeEventListener(type, fn);
    void this.el;
  }
}
