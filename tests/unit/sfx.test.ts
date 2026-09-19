import { describe, expect, it } from "vitest";
import audio from "../../public/assets/manifest/audio.json";
import { buildSfxPlaceholder } from "../../src/assets/placeholders";
import type { AssetEntry } from "../../src/assets/manifest";

/** Just enough of an AudioContext for the synthesizers. */
const fakeAc = {
  sampleRate: 8000,
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { length, sampleRate, duration: length / sampleRate, getChannelData: () => data };
  },
} as unknown as BaseAudioContext;

describe("assets/sfx placeholders", () => {
  for (const entry of audio.assets.filter((e) => e.id.startsWith("sfx."))) {
    it(`${entry.id} synthesizes a finite, audible, short buffer`, () => {
      const buf = buildSfxPlaceholder(fakeAc, entry as unknown as AssetEntry);
      const data = buf.getChannelData(0);
      let peak = 0;
      for (const v of data) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeGreaterThan(0.5);
      expect(peak).toBeLessThanOrEqual(0.7 + 1e-6);
      expect(buf.duration).toBeLessThan(1);
    });
  }
});
