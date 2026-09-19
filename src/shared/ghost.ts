/**
 * Ghost tracks: where a runner was, sampled at `GHOST_HZ` of run time, packed small enough to ride
 * along with a run submission (4 bytes a sample: ~7 KB for a 3-minute run). Shared by the client,
 * which records and replays them, and the Worker, which checks them against the run's claim.
 *
 * Layout (little endian): u8 version, u8 hz, u32 count, then per sample u16 distance step in
 * centimetres, i8 lateral position (1/40 m), u8 height (1/20 m). Steps are taken from the
 * reconstructed previous value, so rounding never drifts over a long run.
 */
export const GHOST_HZ = 10;
/** 20 minutes at GHOST_HZ. */
export const GHOST_MAX_SAMPLES = 12000;
/** Base64 length of a full-size track (plus header): the Worker refuses anything bigger. */
export const GHOST_MAX_CHARS = Math.ceil(((6 + GHOST_MAX_SAMPLES * 4) * 4) / 3) + 4;

const VERSION = 1;
const HEADER = 6;

export interface GhostTrack {
  /** Samples in use. */
  count: number;
  /** Distance run at sample i (m). */
  dist: Float32Array;
  /** Lateral position (m). */
  x: Float32Array;
  /** Height above the road (m). */
  y: Float32Array;
}

export function encodeGhost(dist: ArrayLike<number>, x: ArrayLike<number>, y: ArrayLike<number>, count: number): string {
  const n = Math.max(0, Math.min(count, GHOST_MAX_SAMPLES));
  const bytes = new Uint8Array(HEADER + n * 4);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, VERSION);
  view.setUint8(1, GHOST_HZ);
  view.setUint32(2, n, true);
  let cm = 0;
  for (let i = 0; i < n; i++) {
    const step = Math.max(0, Math.min(65535, Math.round(dist[i] * 100) - cm));
    cm += step;
    const o = HEADER + i * 4;
    view.setUint16(o, step, true);
    view.setInt8(o + 2, Math.max(-127, Math.min(127, Math.round(x[i] * 40))));
    view.setUint8(o + 3, Math.max(0, Math.min(255, Math.round(y[i] * 20))));
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(bin);
}

/** Null for anything that is not a well-formed track. */
export function decodeGhost(data: string): GhostTrack | null {
  if (typeof data !== "string" || data.length < 8 || data.length > GHOST_MAX_CHARS) return null;
  let bin: string;
  try {
    bin = atob(data);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  if (bytes.length < HEADER || view.getUint8(0) !== VERSION || view.getUint8(1) !== GHOST_HZ) return null;
  const n = view.getUint32(2, true);
  if (n > GHOST_MAX_SAMPLES || bytes.length !== HEADER + n * 4) return null;
  const track: GhostTrack = { count: n, dist: new Float32Array(n), x: new Float32Array(n), y: new Float32Array(n) };
  let cm = 0;
  for (let i = 0; i < n; i++) {
    const o = HEADER + i * 4;
    cm += view.getUint16(o, true);
    track.dist[i] = cm / 100;
    track.x[i] = view.getInt8(o + 2) / 40;
    track.y[i] = view.getUint8(o + 3) / 20;
  }
  return track;
}

/**
 * Does a track fit the run it came with? Its length must match the run time and its last sample
 * the claimed distance (a little slack for the final fraction of a sample and rounding).
 */
export function ghostMatchesRun(track: GhostTrack, duration: number, distance: number): boolean {
  if (track.count < 2) return false;
  if (Math.abs(track.count / GHOST_HZ - duration) > 2) return false;
  const end = track.dist[track.count - 1];
  return Math.abs(end - distance) <= Math.max(5, distance * 0.03);
}

/** Position along a track at run time `t` (s), interpolated; false once the track has ended. */
export function sampleGhost(track: GhostTrack, t: number, out: { dist: number; x: number; y: number }): boolean {
  const f = Math.max(0, t) * GHOST_HZ;
  const i = Math.floor(f);
  if (i >= track.count - 1) {
    const last = track.count - 1;
    out.dist = track.dist[last];
    out.x = track.x[last];
    out.y = track.y[last];
    return false;
  }
  const a = f - i;
  out.dist = track.dist[i] + (track.dist[i + 1] - track.dist[i]) * a;
  out.x = track.x[i] + (track.x[i + 1] - track.x[i]) * a;
  out.y = track.y[i] + (track.y[i + 1] - track.y[i]) * a;
  return true;
}
