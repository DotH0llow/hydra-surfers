/**
 * Screen registry. Screens are DOM overlays created lazily by UiRoot. Replace a screen by
 * registering the same name again from its module (last registration wins).
 */
import type { EventBus } from "../../core/events";
import type { ProfileStore } from "../../core/store";
import type { AssetLibrary } from "../../assets/AssetLibrary";
import type { RunResult } from "../../game/Run";
import type { RunState, StartRunOptions } from "../../game/types";
import type brandJson from "../../brand/brand.json";

export const SCREEN_NAMES = ["home", "run", "pause", "gameover", "shop", "missions", "leaderboard", "settings"] as const;
export type ScreenName = (typeof SCREEN_NAMES)[number] | (string & {});

export interface ScreenHost {
  readonly bus: EventBus;
  readonly assets: AssetLibrary;
  readonly store: ProfileStore;
  readonly brand: typeof brandJson;
  readonly runState: Readonly<RunState>;
  readonly lastResult: (RunResult & { newBest: boolean; best: number }) | null;
  goto(screen: ScreenName): void;
  startRun(opts?: StartRunOptions): void;
}

export interface Screen {
  readonly el: HTMLElement;
  show(): void;
  hide(): void;
  /** Called every rendered frame while visible. */
  update?(frameDt: number): void;
}

export type ScreenFactory = (host: ScreenHost) => Screen;

declare module "../../core/events" {
  interface EventMap {
    "ui:click": { id: string };
  }
}

const factories = new Map<string, ScreenFactory>();

export function registerScreen(name: ScreenName, factory: ScreenFactory): void {
  factories.set(name, factory);
}

export function getScreenFactory(name: ScreenName): ScreenFactory | undefined {
  return factories.get(name);
}
