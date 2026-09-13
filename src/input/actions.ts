/** Abstract input actions. Every input source (touch, mouse, keyboard, debug API) produces these. */

export const ACTIONS = ["left", "right", "jump", "roll", "hoverboard", "pause", "tap"] as const;
export type Action = (typeof ACTIONS)[number];
export type InputSource = "touch" | "mouse" | "pen" | "keyboard" | "debug";

export function isAction(v: unknown): v is Action {
  return typeof v === "string" && (ACTIONS as readonly string[]).includes(v);
}

declare module "../core/events" {
  interface EventMap {
    /** Emitted the moment an action is recognised (wall-clock time, before the sim consumes it). */
    "input:action": { action: Action; source: InputSource };
  }
}
