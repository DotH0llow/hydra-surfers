/**
 * Rain streaks: one LineSegments draw call. Each streak is two vertices sharing a scattered seed
 * position; the vertex shader makes it fall, rush past with the road and lean along the apparent
 * wind (the fall plus the runner's speed), so the CPU only writes a few uniforms per frame and the
 * amount is just the draw range. Owned by Atmosphere, driven by the weather/event mood's `rain`.
 */
import { BufferAttribute, BufferGeometry, Color, LineSegments, ShaderMaterial, Vector3 } from "three";
import { defineTuning } from "../../core/tuning";
import { Rng } from "../../core/rng";

export const RAIN = defineTuning("rain", "Rain", {
  streaks: { default: 700, min: 0, max: 2000, step: 50, label: "Streaks at full rain (restart the page)" },
  fallSpeed: { default: 14, min: 1, max: 60, step: 0.5, label: "Fall speed", unit: "m/s" },
  length: { default: 0.9, min: 0.1, max: 4, step: 0.05, label: "Streak length at rest", unit: "m" },
  lengthPerSpeed: { default: 0.035, min: 0, max: 0.2, step: 0.005, label: "Extra length per m/s of run speed", unit: "m" },
  opacity: { default: 0.4, min: 0, max: 1, step: 0.01, label: "Opacity" },
  fadeSeconds: { default: 1.5, min: 0.05, max: 10, step: 0.05, label: "Fade in/out", unit: "s" },
});

/** The box of rain around the runner (floating origin: the runner is at z = 0, the road ahead is -z). */
const HALF_WIDTH = 12;
const HEIGHT = 12;
const BEHIND = 6;
const AHEAD = 60;
const DEPTH = BEHIND + AHEAD;

const VERTEX = /* glsl */ `
uniform float uFall;
uniform float uTravel;
uniform float uLength;
uniform vec3 uDir;
attribute float aEnd;
varying float vEnd;
void main() {
  vEnd = aEnd;
  float y = mod(position.y - uFall, ${HEIGHT.toFixed(1)});
  float z = mod(position.z + uTravel, ${DEPTH.toFixed(1)}) - ${AHEAD.toFixed(1)};
  vec3 p = vec3(position.x, y, z) + uDir * (aEnd * uLength);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vEnd;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * (1.0 - 0.85 * vEnd));
}`;

export class Rain {
  readonly mesh: LineSegments;
  private readonly count: number;
  private readonly dir = new Vector3(0, 1, 0);
  private readonly uniforms = {
    uFall: { value: 0 },
    uTravel: { value: 0 },
    uLength: { value: 1 },
    uDir: { value: this.dir },
    uColor: { value: new Color("#c9d6e6") },
    uOpacity: { value: 0.3 },
  };
  private amount = 0;
  private lastTime = -1;

  constructor() {
    this.count = Math.max(0, Math.round(RAIN.streaks));
    const pos = new Float32Array(this.count * 6);
    const end = new Float32Array(this.count * 2);
    const rng = new Rng(0x7a1);
    for (let i = 0; i < this.count; i++) {
      const x = (rng.next() * 2 - 1) * HALF_WIDTH;
      const y = rng.next() * HEIGHT;
      const z = rng.next() * DEPTH;
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("aEnd", new BufferAttribute(end, 1));
    geo.setDrawRange(0, 0);
    const mat = new ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false });
    this.mesh = new LineSegments(geo, mat);
    // the shader moves every vertex, so the geometry's bounds mean nothing
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  /**
   * @param target 0..1 rain wanted now (eased toward over `fadeSeconds`)
   * @param time   sim time (s): rain freezes with the game when paused
   * @param travel distance run (m): streaks rush past with the road
   * @param speed  run speed (m/s): the streaks lean and stretch with it
   */
  update(target: number, time: number, travel: number, speed: number): void {
    // the first frame of a run starts at the weather; after that it eases (render frames between
    // sim ticks see dt = 0 and leave it alone)
    const first = this.lastTime < 0;
    const dt = first ? 0 : Math.max(0, Math.min(0.25, time - this.lastTime));
    this.lastTime = time;
    const k = first ? 1 : Math.min(1, dt / RAIN.fadeSeconds);
    this.amount += (Math.max(0, Math.min(1, target)) - this.amount) * k;
    const n = Math.round(this.count * this.amount);
    this.mesh.visible = n > 0;
    if (n === 0) return;
    this.mesh.geometry.setDrawRange(0, n * 2);
    const u = this.uniforms;
    // offsets are wrapped on the CPU so the shader never sees large floats
    u.uFall.value = (time * RAIN.fallSpeed) % HEIGHT;
    u.uTravel.value = travel % DEPTH;
    // a streak is the path the drop just traced relative to the runner: up and away from the camera
    this.dir.set(0, RAIN.fallSpeed, -speed).normalize();
    u.uLength.value = RAIN.length + RAIN.lengthPerSpeed * speed;
    u.uOpacity.value = RAIN.opacity;
  }

  /** New run: no fade from the last one. */
  reset(): void {
    this.amount = 0;
    this.lastTime = -1;
    this.mesh.visible = false;
  }
}
