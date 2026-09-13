/** Sky colour, fog, lights and camera draw distance. */
import { Color, DirectionalLight, Fog, HemisphereLight } from "three";
import { defineTuning } from "../../core/tuning";
import type { RunContext, RunSystem } from "../types";
import brand from "../../brand/brand.json";

export const ATMOS = defineTuning("atmosphere", "Atmosphere & light", {
  fogNear: { default: 55, min: 0, max: 400, step: 1, label: "Fog start", unit: "m" },
  fogFar: { default: 200, min: 20, max: 800, step: 1, label: "Fog end", unit: "m" },
  drawDistance: { default: 260, min: 40, max: 1000, step: 10, label: "Camera far plane", unit: "m" },
  hemiIntensity: { default: 1.7, min: 0, max: 5, step: 0.05, label: "Sky light intensity" },
  sunIntensity: { default: 2.2, min: 0, max: 6, step: 0.05, label: "Sun intensity" },
  sunElevation: { default: 55, min: 5, max: 90, step: 1, label: "Sun elevation", unit: "°" },
  sunAzimuth: { default: -30, min: -180, max: 180, step: 1, label: "Sun azimuth", unit: "°" },
});

export class Atmosphere implements RunSystem {
  readonly id = "atmosphere";
  readonly order = 5;
  private readonly fog = new Fog(new Color(brand.palette.fog), ATMOS.fogNear, ATMOS.fogFar);
  private readonly hemi = new HemisphereLight(0xdfefff, 0x5d5a52, ATMOS.hemiIntensity);
  private readonly sun = new DirectionalLight(0xfff1dc, ATMOS.sunIntensity);

  init(ctx: RunContext): void {
    ctx.scene.background = new Color(brand.palette.sky);
    ctx.scene.fog = this.fog;
    ctx.scene.add(this.hemi, this.sun, this.sun.target);
  }

  render(ctx: RunContext): void {
    this.fog.near = ATMOS.fogNear;
    this.fog.far = ATMOS.fogFar;
    this.hemi.intensity = ATMOS.hemiIntensity;
    this.sun.intensity = ATMOS.sunIntensity;
    const el = (ATMOS.sunElevation * Math.PI) / 180;
    const az = (ATMOS.sunAzimuth * Math.PI) / 180;
    this.sun.position.set(Math.sin(az) * Math.cos(el) * 50, Math.sin(el) * 50, Math.cos(az) * Math.cos(el) * 50);
    const cam = ctx.camera3;
    if (cam.far !== ATMOS.drawDistance) {
      cam.far = ATMOS.drawDistance;
      cam.updateProjectionMatrix();
    }
  }
}
