import { describe, expect, it } from "vitest";
import { GHOST_HZ, decodeGhost, encodeGhost, ghostMatchesRun, sampleGhost } from "../../src/shared/ghost";
import { GhostRecorder } from "../../src/game/ghost/Ghost";
import type { RunContext } from "../../src/game/types";

/** A 3-minute run: speeding up, weaving between lanes, a jump every few seconds. */
function fakeRun(seconds: number) {
  const n = seconds * GHOST_HZ + 1;
  const dist = new Float32Array(n);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  let d = 0;
  for (let i = 0; i < n; i++) {
    const t = i / GHOST_HZ;
    d += (12 + t * 0.06) / GHOST_HZ;
    dist[i] = d;
    x[i] = Math.round(Math.sin(t * 0.7)) * 2.5;
    y[i] = (t % 4) < 0.6 ? Math.sin(((t % 4) / 0.6) * Math.PI) * 1.4 : 0;
  }
  return { dist, x, y, n };
}

describe("shared/ghost codec", () => {
  it("round-trips a run at 4 bytes a sample without drifting", () => {
    const run = fakeRun(180);
    const data = encodeGhost(run.dist, run.x, run.y, run.n);
    expect(data.length).toBeLessThan(10_000);
    const t = decodeGhost(data)!;
    expect(t.count).toBe(run.n);
    let worst = 0;
    for (let i = 0; i < run.n; i++) {
      worst = Math.max(worst, Math.abs(t.dist[i] - run.dist[i]));
      expect(Math.abs(t.x[i] - run.x[i])).toBeLessThanOrEqual(1 / 80 + 1e-6);
      expect(Math.abs(t.y[i] - run.y[i])).toBeLessThanOrEqual(1 / 40 + 1e-6);
    }
    // steps are taken from the reconstructed value: the error stays at rounding, even at the end
    expect(worst).toBeLessThanOrEqual(0.006);
  });

  it("refuses anything that is not a track", () => {
    expect(decodeGhost("")).toBeNull();
    expect(decodeGhost("not base64 at all!")).toBeNull();
    // version 2 header: not a format this build reads
    expect(decodeGhost(btoa(String.fromCharCode(2, 10, 0, 0, 0, 0)))).toBeNull();
    const ok = encodeGhost([1, 2], [0, 0], [0, 0], 2);
    expect(decodeGhost(ok.slice(0, -4))).toBeNull();
  });

  it("matches a track to its run's time and distance only", () => {
    const run = fakeRun(90);
    const t = decodeGhost(encodeGhost(run.dist, run.x, run.y, run.n))!;
    const end = run.dist[run.n - 1];
    expect(ghostMatchesRun(t, 90, end)).toBe(true);
    expect(ghostMatchesRun(t, 60, end)).toBe(false);
    expect(ghostMatchesRun(t, 90, end * 1.2)).toBe(false);
  });

  it("interpolates between samples and reports the end of the track", () => {
    const t = decodeGhost(encodeGhost([0, 10, 20], [0, 2.5, 2.5], [0, 1, 0], 3))!;
    const at = { dist: 0, x: 0, y: 0 };
    expect(sampleGhost(t, 0.05, at)).toBe(true);
    expect(at.dist).toBeCloseTo(5, 2);
    expect(at.x).toBeCloseTo(1.25, 2);
    expect(sampleGhost(t, 5, at)).toBe(false);
    expect(at.dist).toBeCloseTo(20, 2);
  });
});

describe("game/ghost recorder", () => {
  it("keeps one sample per 1/GHOST_HZ of run time, repeating the position while the clock waits", () => {
    const state = { mode: "running", time: 0, distance: 0 };
    const ctx = { state, player: { x: 0, y: 0 } } as unknown as RunContext;
    const rec = new GhostRecorder();
    rec.reset();
    const dt = 1 / 120;
    for (let i = 0; i < 120 * 3; i++) {
      state.time += dt;
      state.distance += 12 * dt;
      rec.fixedUpdate(ctx);
    }
    expect(rec.count).toBe(Math.floor(state.time * GHOST_HZ) + 1);
    // sample i is taken on the first tick at or past i / GHOST_HZ
    expect(rec.dist[rec.count - 1]).toBeCloseTo(((rec.count - 1) / GHOST_HZ) * 12, 0);
    // crashed: nothing is recorded; when the clock moves again the gap is filled
    state.mode = "crashed";
    rec.fixedUpdate(ctx);
    const before = rec.count;
    state.mode = "running";
    state.time += 1;
    rec.fixedUpdate(ctx);
    expect(rec.count).toBe(before + GHOST_HZ);
  });
});
