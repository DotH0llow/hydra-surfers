def patch(p, pairs):
    s = open(p, encoding='utf-8').read().replace('\r\n', '\n')
    for a, b in pairs:
        if a not in s:
            raise SystemExit(f'miss in {p}: {a[:90]}')
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf-8').write(s)

patch('tests/unit/fairness.test.ts', [
('''/**
 * Layout fairness: no procedural road may contain a stretch the runner cannot get through.
 *
 * Barricades, beams, ramps and gatehouses are always passable by an action (jump, roll, run up,
 * run through), so the only things that close a lane are wagons and runaway carts.''', '''/**
 * Layout fairness: no procedural road may contain a stretch the runner cannot get through.
 *
 * Barricades, beams, holes, ramps and gatehouses are always passable by an action (jump, roll, run
 * up, run through), so the lane closers are wagons, portcullises and dragon fire, plus the things
 * riding the other way (runaway carts and knights).'''),
('''import { WAGON, RUNAWAY } from "../../src/game/obstacles/builtin";''', '''import "../../src/game/obstacles/builtin";
import { WAGON } from "../../src/game/obstacles/builtin";
import { getObstacleType } from "../../src/game/obstacles/registry";'''),
('''interface Placed {
  type: string;
  lane: number;
  s: number;
  length: number;
  speed: number;
  /** Nominal runner speed the spawner planned this pattern for. */
  planned: number;
}''', '''interface Placed {
  type: string;
  lane: number;
  s: number;
  length: number;
  speed: number;
  /** How far ahead a moving obstacle sets off (its type's moveWithin). */
  reach: number;
  /** Nominal runner speed the spawner planned this pattern for. */
  planned: number;
}

/** Types that close their lane standing still. */
const BLOCKERS: ReadonlySet<string> = new Set(["wagon", "portcullis", "fire"]);'''),
('''        placed.push({ type, lane, s, length: length ?? 0, speed: speed ?? 0, planned: sp.speed });''', '''        const def = getObstacleType(type);
        placed.push({ type, lane, s, length: length ?? def?.defaultLength() ?? 0, speed: speed ?? 0, reach: def?.moveWithin?.() ?? 0, planned: sp.speed });'''),
('''function blocksFor(placed: Placed[], rules: RunRules, scale: number): Block[] {
  return placed.filter((o) => o.type === "wagon" || o.type === "runaway").map((o) => {
    if (o.type !== "runaway") return { type: o.type, lane: o.lane, from: o.s, to: o.s + o.length };
    const v = o.planned * rules.speedMul * scale;
    const r = o.speed * scale;
    const meet = o.s - r * (RUNAWAY.spawnAhead / (v + r));
    return { type: o.type, lane: o.lane, from: meet, to: meet + (o.length * v) / (v + r) };
  });
}''', '''function blocksFor(placed: Placed[], rules: RunRules, scale: number): Block[] {
  return placed
    .filter((o) => o.speed > 0 || BLOCKERS.has(o.type))
    .map((o) => {
      if (o.speed <= 0) return { type: o.type, lane: o.lane, from: o.s, to: o.s + o.length };
      const v = o.planned * rules.speedMul * scale;
      const r = o.speed * scale;
      const meet = o.s - r * (o.reach / (v + r));
      return { type: o.type, lane: o.lane, from: meet, to: meet + (o.length * v) / (v + r) };
    });
}'''),
])
print('ok')
