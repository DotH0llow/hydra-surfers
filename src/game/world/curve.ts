/**
 * Curved-world bend: a vertex-shader offset proportional to view-space depth², so the track
 * falls away over the horizon (and optionally sweeps sideways). Visual only — sim space is flat.
 *
 * Call `curveObject(obj)` for every mesh added to the scene (materials are patched once and
 * shared). Uniforms are global and updated from tuning each frame via `updateCurveUniforms()`.
 */
import type { Material, Mesh, Object3D } from "three";
import { defineTuning } from "../../core/tuning";

export const CURVE = defineTuning("curve", "Curved world", {
  down: { default: 0.0016, min: 0, max: 0.01, step: 0.0001, label: "Bend down (per m²)", help: "Vertical drop = down × depth²" },
  side: { default: 0, min: -0.004, max: 0.004, step: 0.0001, label: "Bend sideways (per m²)" },
  startDepth: { default: 6, min: 0, max: 60, step: 1, label: "Bend start depth", unit: "m" },
});

export const curveUniforms = {
  uCurveDown: { value: CURVE.down },
  uCurveSide: { value: CURVE.side },
  uCurveStart: { value: CURVE.startDepth },
};

export function updateCurveUniforms(): void {
  curveUniforms.uCurveDown.value = CURVE.down;
  curveUniforms.uCurveSide.value = CURVE.side;
  curveUniforms.uCurveStart.value = CURVE.startDepth;
}

const CHUNK = /* glsl */ `#include <project_vertex>
  {
    float yd_depth = max(0.0, -mvPosition.z - uCurveStart);
    float yd_d2 = yd_depth * yd_depth;
    mvPosition.y -= uCurveDown * yd_d2;
    mvPosition.x += uCurveSide * yd_d2;
    gl_Position = projectionMatrix * mvPosition;
  }`;

const HEADER = "uniform float uCurveDown;\nuniform float uCurveSide;\nuniform float uCurveStart;\n";

export function curveMaterial(mat: Material): void {
  if (mat.userData.ydCurved) return;
  mat.userData.ydCurved = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uCurveDown = curveUniforms.uCurveDown;
    shader.uniforms.uCurveSide = curveUniforms.uCurveSide;
    shader.uniforms.uCurveStart = curveUniforms.uCurveStart;
    if (!shader.vertexShader.includes("#include <project_vertex>")) return;
    shader.vertexShader = HEADER + shader.vertexShader.replace("#include <project_vertex>", CHUNK);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|yd-curve-1`;
  mat.needsUpdate = true;
}

export function curveObject(obj: Object3D): void {
  obj.traverse((o) => {
    const m = (o as Mesh).material;
    if (!m) return;
    if (Array.isArray(m)) m.forEach(curveMaterial);
    else curveMaterial(m);
    // Bent vertices leave their un-bent bounds; objects are placed by the game so skip culling.
    o.frustumCulled = false;
  });
}
