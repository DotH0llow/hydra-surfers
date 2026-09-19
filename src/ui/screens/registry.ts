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
import type { CommunityState, LeaderboardService, SubmitResult } from "../../online/LeaderboardService";
import type { RunReport } from "../../meta/progression";
import type { RunStats } from "../../meta/stats";
import type { RunMode } from "../../meta/modes";
import type brandJson from "../../brand/brand.json";

export const SCREEN_NAMES = ["home", "run", "pause", "revive", "gameover", "shop", "missions", "leaderboard", "settings"] as const;
export type ScreenName = (typeof SCREEN_NAMES)[number] | (string & {});

export interface ResultView extends RunResult {
  newBest: boolean;
  best: number;
  /** Missions completed by this run (null for runs that do not count). */
  missions?: { completed: string[]; setAdvanced: boolean; multiplierBonus: number } | null;
  /** Everything the run earned (see meta/progression.ts). */
  report?: RunReport;
  /** The run's statistics (combo, near misses …). */
  stats?: RunStats;
  modeName?: string;
  board?: string;
  /** False for practice runs after the ranked attempts of a seeded board are spent. */
  ranked?: boolean;
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
  /** Mode of the current or last run. */
  readonly currentMode: RunMode;
  /** False for a practice run after a seeded board's ranked attempts are spent. */
  readonly ranked: boolean;
  /** Display name everyone else sees. */
  readonly playerName: string;
  /** False until the player picks a name (the tavern asks on the first visit). */
  readonly nameChosen: boolean;
  renamePlayer(name: string): Promise<{ ok: boolean; error?: "invalid" | "taken" | "offline" }>;
  /** One line about the nearest rival ("#4 no Diário · 230 pontos atrás de Marina"), or null. */
  /** Tavern arrival: the rival line and one-off notices (group rewards claimed, who passed you). */
  tavernNews(): Promise<{ rival: string | null; notices: string[] }>;
  /** The ghost being raced (daily run): whose it is and how far ahead (m, negative = behind). */
  ghostLead(): { name: string; lead: number } | null;
  /** Nearest power-up ahead when the build reveals them, else null. */
  upcomingPickup(): { lane: number; dist: number } | null;
  /** Community bounty progress, or null offline. */
  communityProgress(): Promise<CommunityState | null>;
  /** The recovery code once the player is registered online, else null. */
  recoveryCode(): string | null;
  /** Restores an account from a recovery code. */
  recover(code: string): Promise<boolean>;
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
