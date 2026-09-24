/**
 * Lightweight, pooled sparkle bursts for the high-value moments in a run.  They use one Points
 * draw call, keep their position in track-space, and never influence simulation or collision.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Points, PointsMaterial } from "three";
import { defineTuning } from "../../core/tuning";
import { registerRunSystem } from "../systems";
import { renderZ } from "../world/coords";
import type { RunContext, RunSystem } from "../types";

export const VFX = defineTuning("vfx", "Run VFX", {
  sparkles: { default: 96, min: 24, max: 256, step: 8, label: "Sparkle particle capacity" },
  coinSeconds: { default: 0.42, min: 0.1, max: 1.5, step: 0.01, label: "Coin sparkle duration", unit: "s" },
  powerSeconds: { default: 0.9, min: 0.1, max: 2, step: 0.05, label: "Power burst duration", unit: "s" },
  size: { default: 0.19, min: 0.03, max: 0.8, step: 0.01, label: "Sparkle size", unit: "m" },
});

const CAP = 256;
const GOLD = new Color("#ffd76a");
const ARCANE = new Color("#8ee8ff");
const CRASH = new Color("#ff9a5b");

interface Particle {
  live: boolean;
  s: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  vs: number;
  age: number;
  life: number;
  color: Color;
}

export class RunVfx implements RunSystem {
  readonly id = "runVfx";
  readonly order = 114;
  private readonly particles: Particle[] = Array.from({ length: CAP }, () => ({ live: false, s: 0, x: 0, y: 0, vx: 0, vy: 0, vs: 0, age: 0, life: 0, color: GOLD }));
  private readonly positions = new Float32Array(CAP * 3);
  private readonly colors = new Float32Array(CAP * 3);
  private readonly geometry = new BufferGeometry();
  private readonly material = new PointsMaterial({ size: VFX.size, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true });
  private readonly points = new Points(this.geometry, this.material);
  private ctx: RunContext | null = null;
  private cursor = 0;

  constructor() {
    const pos = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
    const col = new BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute("position", pos);
    this.geometry.setAttribute("color", col);
    this.geometry.setDrawRange(0, 0);
  }

  init(ctx: RunContext): void {
    this.ctx = ctx;
    // Reuse the soft radial asset as an alpha mask so particles read as sparks, not square points.
    this.material.alphaMap = ctx.assets.getTexture("fx.shadow.blob");
    this.material.needsUpdate = true;
    this.points.name = "run-sparkles";
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    ctx.scene.add(this.points);
    ctx.bus.on("coin:collect", (e) => this.burst(e.s, e.lane * 2.5, e.y, GOLD, 7, VFX.coinSeconds, 1.8));
    ctx.bus.on("powerup:start", () => this.burst(ctx.state.distance, ctx.player.x, ctx.player.y + 0.9, ARCANE, 22, VFX.powerSeconds, 3.4));
    ctx.bus.on("run:crash", () => this.burst(ctx.state.distance, ctx.player.x, ctx.player.y + 0.7, CRASH, 28, 0.7, 4.4));
  }

  reset(): void {
    for (const p of this.particles) p.live = false;
    this.points.visible = false;
  }

  fixedUpdate(_ctx: RunContext, dt: number): void {
    for (const p of this.particles) {
      if (!p.live) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.live = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.s += p.vs * dt;
      p.vy -= 4.8 * dt;
    }
  }

  render(ctx: RunContext): void {
    let n = 0;
    for (const p of this.particles) {
      if (!p.live) continue;
      const fade = 1 - p.age / p.life;
      const k = n * 3;
      this.positions[k] = p.x;
      this.positions[k + 1] = p.y;
      this.positions[k + 2] = renderZ(p.s, ctx.renderDistance);
      this.colors[k] = p.color.r * fade;
      this.colors[k + 1] = p.color.g * fade;
      this.colors[k + 2] = p.color.b * fade;
      n++;
    }
    this.geometry.setDrawRange(0, n);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.material.size = VFX.size;
    this.points.visible = n > 0;
  }

  private burst(s: number, x: number, y: number, color: Color, count: number, life: number, force: number): void {
    if (!this.ctx) return;
    const n = Math.min(CAP, Math.max(1, count));
    for (let i = 0; i < n; i++) {
      const p = this.particles[this.cursor++ % CAP];
      const a = (i / n) * Math.PI * 2 + this.ctx.rng.range(-0.24, 0.24);
      const speed = force * this.ctx.rng.range(0.35, 1);
      p.live = true;
      p.s = s;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * speed;
      p.vy = this.ctx.rng.range(0.45, 1.2) * force;
      p.vs = Math.sin(a) * speed * 0.65;
      p.age = 0;
      p.life = life * this.ctx.rng.range(0.72, 1.12);
      p.color = color;
    }
  }
}

registerRunSystem(() => new RunVfx());
