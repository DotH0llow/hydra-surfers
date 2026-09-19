/**
 * Sky colour, fog, lights and camera draw distance — all of it taken from the region the runner is
 * crossing, blended across boundaries so a new region announces itself in the air before its
 * scenery arrives.
 *
 * The tuning here is deliberately relative: biomes own the absolute palette and the designer owns
 * global scales on top (thicker fog everywhere, dimmer sun everywhere). That keeps one slider from
 * having to be re-balanced eight times.
 */
import { Color, DirectionalLight, Fog, HemisphereLight } from "three";
import { defineTuning } from "../../core/tuning";
import type { RunContext, RunSystem } from "../types";
import { BIOMES, type BiomeDef } from "./biomes";
import type { BiomeSystem } from "./BiomeSystem";
import type { EventDirector, Mood } from "./events";

export const ATMOS = defineTuning("atmosphere", "Atmosphere & light", {
  fogNearScale: { default: 1, min: 0.2, max: 3, step: 0.05, label: "Fog start x (region value)" },
  fogFarScale: { default: 1, min: 0.2, max: 3, step: 0.05, label: "Fog end x (region value)" },
  drawDistance: { default: 260, min: 40, max: 1000, step: 10, label: "Camera far plane", unit: "m" },
  hemiScale: { default: 1, min: 0, max: 3, step: 0.05, label: "Sky light x (region value)" },
  sunScale: { default: 1, min: 0, max: 3, step: 0.05, label: "Sun x (region value)" },
  sunElevation: { default: 55, min: 5, max: 90, step: 1, label: "Sun elevation", unit: "°" },
  sunAzimuth: { default: -30, min: -180, max: 180, step: 1, label: "Sun azimuth", unit: "°" },
});

const tmpA = new Color();
const tmpB = new Color();

export class Atmosphere implements RunSystem {
  readonly id = "atmosphere";
  readonly order = 5;
  private readonly sky = new Color(BIOMES[0].sky);
  private readonly fog = new Fog(new Color(BIOMES[0].fog), 60, 200);
  private readonly hemi = new HemisphereLight(0xdfefff, 0x5d5a52, 1.7);
  private readonly sun = new DirectionalLight(0xfff1dc, 2.2);
  private biomes: BiomeSystem | undefined;
  private events: EventDirector | undefined;

  init(ctx: RunContext): void {
    this.biomes = ctx.getSystem<BiomeSystem>("biomes");
    this.events = ctx.getSystem<EventDirector>("events");
    ctx.scene.background = this.sky;
    ctx.scene.fog = this.fog;
    ctx.scene.add(this.hemi, this.sun, this.sun.target);
  }

  render(ctx: RunContext): void {
    const bs = this.biomes;
    const from: BiomeDef = bs?.current ?? BIOMES[0];
    const to: BiomeDef = bs?.next ?? from;
    const t = bs?.blend ?? 0;

    this.sky.set(from.sky).lerp(tmpB.set(to.sky), t);
    this.fog.color.set(from.fog).lerp(tmpB.set(to.fog), t);
    this.fog.near = mix(from.fogNear, to.fogNear, t) * ATMOS.fogNearScale;
    this.fog.far = Math.max(this.fog.near + 1, mix(from.fogFar, to.fogFar, t) * ATMOS.fogFarScale);

    this.hemi.color.set(from.hemiSky).lerp(tmpB.set(to.hemiSky), t);
    this.hemi.groundColor.set(from.hemiGround).lerp(tmpB.set(to.hemiGround), t);
    this.hemi.intensity = mix(from.hemiIntensity, to.hemiIntensity, t) * ATMOS.hemiScale;
    tmpA.set(from.sunColor).lerp(tmpB.set(to.sunColor), t);
    this.sun.color.copy(tmpA);
    this.sun.intensity = mix(from.sunIntensity, to.sunIntensity, t) * ATMOS.sunScale;

    // weather for the whole run, then any event the runner is inside right now
    this.applyMood(this.events?.weather);
    this.applyMood(this.events?.at(ctx.renderDistance)?.mood);

    const el = (ATMOS.sunElevation * Math.PI) / 180;
    const az = (ATMOS.sunAzimuth * Math.PI) / 180;
    this.sun.position.set(Math.sin(az) * Math.cos(el) * 50, Math.sin(el) * 50, Math.cos(az) * Math.cos(el) * 50);

    const cam = ctx.camera3;
    if (cam.far !== ATMOS.drawDistance) {
      cam.far = ATMOS.drawDistance;
      cam.updateProjectionMatrix();
    }
  }

  /** Leans sky and fog toward the mood's tint, dims the light and pulls the fog in. */
  private applyMood(mood: Mood | null | undefined): void {
    if (!mood) return;
    if (mood.tintAmount > 0) {
      tmpB.set(mood.tint);
      this.sky.lerp(tmpB, mood.tintAmount);
      this.fog.color.lerp(tmpB, mood.tintAmount);
    }
    this.hemi.intensity *= mood.light;
    this.sun.intensity *= mood.light;
    this.fog.near *= mood.fog;
    this.fog.far = Math.max(this.fog.near + 1, this.fog.far * mood.fog);
  }
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
