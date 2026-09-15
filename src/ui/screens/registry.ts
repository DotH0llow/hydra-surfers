/**
 * Screen registry. Screens are DOM overlays created lazily by UiRoot. Replace a screen by
 * registering the same name again from its module (last registration wins).
 */
import type { EventBus } from "../../core/events";
import type { ProfileStore } from "../../core/store";
import type { AssetLibrary } from "../../assets/AssetLibrary";
import type { RunResult } from "../../game/Run";
import type { HoverboardSystem } from "../../game/hoverboard/Hoverboard";
import type { PowerupSystem } from "../../game/powerups/PowerupSystem";
import type { RunState, StartRunOptions } from "../../game/types";
import type { Action } from "../../input/actions";
import type { LeaderboardService, SubmitResult } from "../../online/LeaderboardService";
import type brandJson from "../../brand/brand.json";

export const SCREEN_NAMES = ["home", "run", "pause", "revive", "gameover", "shop", "missions", "leaderboard", "settings"] as const;
export type ScreenName = (typeof SCREEN_NAMES)[number] | (string & {});

export interface ResultView extends RunResult {
  newBest: boolean;
  best: number;
  /** Missions completed by this run (null for runs that do not count). */
  missions?: { completed: string[]; setAdvanced: boolean; multiplierBonus: number } | null;
}

export interface ScreenHost {
  readonly bus: EventBus;
  readonly assets: AssetLibrary;
  readonly store: ProfileStore;
  readonly brand: typeof brandJson;
  readonly runState: Readonly<RunState>;
  readonly lastResult: ResultView | null;
  /** Score submission of the last run (resolves with the rank when the provider knows it). */
  readonly lastSubmit: Promise<SubmitResult | null> | null;
  readonly online: LeaderboardService;
  readonly powerups: PowerupSystem | undefined;
  readonly hoverboard: HoverboardSystem | undefined;
  /** Seconds left of the resume countdown after un-pausing (0 = none). */
  readonly resumeCountdown: number;
  /** Seconds the revive offer stays open. */
  readonly reviveOfferSeconds: number;
  goto(screen: ScreenName): void;
  startRun(opts?: StartRunOptions): void;
  /** Same path as real input (HUD buttons). */
  action(action: Action): void;
  /** Accept the revive offer (spends keys). */
  revive(): void;
  /** Decline / time out the revive offer. */
  skipRevive(): void;
  /** Keys the next revive costs. */
  reviveCost(): number;
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
    /** Short message shown by the HUD (mission complete, key collected …). */
    "ui:toast": { text: string; kind: string };
  }
}

const factories = new Map<string, ScreenFactory>();

export function registerScreen(name: ScreenName, factory: ScreenFactory): void {
  factories.set(name, factory);
}

export function getScreenFactory(name: ScreenName): ScreenFactory | undefined {
  return factories.get(name);
}
