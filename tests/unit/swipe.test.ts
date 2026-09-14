import { afterEach, describe, expect, it } from "vitest";
import { tuning } from "../../src/core/tuning";
import { SwipeRecognizer } from "../../src/input/SwipeRecognizer";
import type { Action, InputSource } from "../../src/input/actions";

/** Minimal element stand-in: stores listeners so tests can drive pointer events directly. */
function fakeEl() {
  const handlers = new Map<string, (e: unknown) => void>();
  const el = {
    addEventListener: (type: string, fn: (e: unknown) => void) => handlers.set(type, fn),
    removeEventListener: (type: string) => handlers.delete(type),
    setPointerCapture: () => {},
  };
  let t = 0;
  const ev = (x: number, y: number, dt = 16) => ({
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    clientX: x,
    clientY: y,
    timeStamp: (t += dt),
    target: null,
    cancelable: true,
    preventDefault() {},
  });
  return {
    el: el as unknown as HTMLElement,
    down: (x: number, y: number) => handlers.get("pointerdown")!(ev(x, y, 0)),
    move: (x: number, y: number) => handlers.get("pointermove")!(ev(x, y)),
    up: (x: number, y: number) => handlers.get("pointerup")!(ev(x, y)),
  };
}

function setup() {
  const f = fakeEl();
  const got: Array<[Action, InputSource]> = [];
  const rec = new SwipeRecognizer(f.el, (a, s) => got.push([a, s]));
  return { ...f, got, rec };
}

/** Drags from (x0,y0) by (dx,dy) in `steps` moves. */
function drag(f: ReturnType<typeof setup>, x0: number, y0: number, dx: number, dy: number, steps = 6) {
  for (let i = 1; i <= steps; i++) f.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
}

describe("SwipeRecognizer", () => {
  afterEach(() => tuning.reset());

  it("fires during the move, before release", () => {
    const f = setup();
    f.down(200, 500);
    drag(f, 200, 500, -90, 0);
    expect(f.got.map((g) => g[0])).toEqual(["left"]);
    f.up(110, 500);
    expect(f.got.map((g) => g[0])).toEqual(["left"]);
  });

  it("a long continuous flick is exactly one action (no repeats per threshold of travel)", () => {
    for (const [dx, dy, action] of [
      [-160, 0, "left"],
      [160, 0, "right"],
      [0, -160, "jump"],
      [0, 160, "roll"],
    ] as const) {
      const f = setup();
      f.down(270, 600);
      drag(f, 270, 600, dx, dy, 12);
      f.up(270 + dx, 600 + dy);
      expect(f.got.map((g) => g[0])).toEqual([action]);
      f.rec.dispose();
    }
  });

  it("chains a different direction in the same touch when swipeRearm = 1", () => {
    const f = setup();
    f.down(270, 600);
    drag(f, 270, 600, -90, 0);
    drag(f, 180, 600, 0, -90);
    f.up(180, 510);
    expect(f.got.map((g) => g[0])).toEqual(["left", "jump"]);
  });

  it("one action per touch when swipeRearm = 0", () => {
    tuning.set("input.swipeRearm", 0);
    const f = setup();
    f.down(270, 600);
    drag(f, 270, 600, -90, 0);
    drag(f, 180, 600, 0, -90);
    expect(f.got.map((g) => g[0])).toEqual(["left"]);
  });

  it("separate touches each fire, even in the same direction", () => {
    const f = setup();
    for (let i = 0; i < 2; i++) {
      f.down(270, 600);
      drag(f, 270, 600, 90, 0);
      f.up(360, 600);
    }
    expect(f.got.map((g) => g[0])).toEqual(["right", "right"]);
  });

  it("a short press without travel is a tap with the pointer source", () => {
    const f = setup();
    f.down(270, 600);
    f.move(273, 602);
    f.up(273, 602);
    expect(f.got).toEqual([["tap", "touch"]]);
  });

  it("respects the angle tolerance (diagonal swipes do nothing)", () => {
    const f = setup();
    f.down(270, 600);
    drag(f, 270, 600, 60, 60);
    expect(f.got).toEqual([]);
  });
});
