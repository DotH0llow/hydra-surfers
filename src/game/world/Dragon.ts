/**
 * The dragon: one flight across the sky when the "Dragão!" event starts, wings beating, while the
 * event burns lanes below (the dragonFire pattern). Pure spectacle — it never collides with
 * anything, so the road stays as fair as the fire the spawner placed.
 */
import { Group, type Object3D } from "three";
import { defineTuning } from "../../core/tuning";
import { registerRunSystem } from "../systems";
import type { RunContext, RunSystem } from "../types";
import { curveObject } from "./curve";

export const DRAGON = defineTuning("dragon", "Dragon flyover", {
  seconds: { default: 4.5, min: 0.5, max: 20, step: 0.1, label: "Time to cross the sky", unit: "s" },
  height: { default: 26, min: 2, max: 80, step: 1, label: "Height above the road", unit: "m" },
  across: { default: 46, min: 5, max: 200, step: 1, label: "Half the width it crosses", unit: "m" },
  fromZ: { default: 150, min: 10, max: 400, step: 5, label: "Comes in this far ahead", unit: "m" },
  toZ: { default: 40, min: 0, max: 200, step: 5, label: "Leaves this far behind", unit: "m" },
  wingBeats: { default: 1.6, min: 0, max: 8, step: 0.1, label: "Wing beats per second", unit: "Hz" },
});

export class DragonFlight implements RunSystem {
  readonly id = "dragon";
  /** After the world is placed; it only draws. */
  readonly order = 112;
  private readonly root = new Group();
  private wingL: Object3D | null = null;
  private wingR: Object3D | null = null;
  /** Seconds into the flight, or -1 when there is no dragon. */
  private t = -1;

  init(ctx: RunContext): void {
    const model = ctx.assets.getModel("env.dragon");
    this.root.name = "dragon";
    this.root.add(model);
    this.wingL = model.getObjectByName("wingL") ?? null;
    this.wingR = model.getObjectByName("wingR") ?? null;
    curveObject(this.root);
    this.root.visible = false;
    ctx.scene.add(this.root);
    ctx.bus.on("event:start", (e) => {
      if (e.id === "dragao") this.t = 0;
    });
  }

  reset(): void {
    this.t = -1;
    this.root.visible = false;
  }

  render(_ctx: RunContext, _alpha: number, frameDt: number): void {
    if (this.t < 0) return;
    this.t += frameDt;
    const u = this.t / Math.max(0.1, DRAGON.seconds);
    if (u >= 1) {
      this.reset();
      return;
    }
    this.root.visible = true;
    // a diagonal pass over the road, dipping lowest as it crosses overhead
    this.root.position.set(-DRAGON.across + 2 * DRAGON.across * u, DRAGON.height - Math.sin(u * Math.PI) * DRAGON.height * 0.25, -DRAGON.fromZ + (DRAGON.fromZ + DRAGON.toZ) * u);
    this.root.rotation.y = -Math.PI / 2 + Math.sin(u * Math.PI) * 0.35;
    const flap = Math.sin(this.t * DRAGON.wingBeats * Math.PI * 2) * 0.55;
    if (this.wingL) this.wingL.rotation.z = flap;
    if (this.wingR) this.wingR.rotation.z = -flap;
  }
}

registerRunSystem(() => new DragonFlight());
