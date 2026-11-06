// Minimap acceptance suite (issue #219 contract): normalized-XZ
// projection assertions plus stub-DOM canvas sink tests (hud.test.ts
// stub-container idiom) with no network, no WebGL, no WASM. Covers the
// (0,0)->(100,100) center read, the (68,68) in-bounds read, edge and
// north-up ordering, dot-size constants, the 200x200 ensure, the 10 Hz
// throttle, and a static hygiene scan proving the ui/ module carries no
// three.js/rapier import.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  drawMinimap,
  draw_minimap,
  ensureMinimap,
  ensure_minimap,
  GATE_DOT,
  gate_dot,
  HALF_EXTENT,
  half_extent,
  MAP_SIZE,
  map_size,
  normalizeMinimap,
  normalize_minimap,
  PLAYER_DOT,
  player_dot,
  projectToMap,
  project_to_map,
  resetMinimapClock,
  reset_minimap_clock,
  RIVAL_DOT,
  rival_dot,
  UPDATE_INTERVAL,
  update_interval,
  updateMinimap,
  update_minimap,
  type MinimapCanvasLike,
  type MinimapContextLike,
  type MinimapDocumentLike,
} from "../src/ui/minimap";

function makeContext(): MinimapContextLike & { rects: number[][] } {
  const rects: number[][] = [];
  return {
    rects,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      rects.push([x, y, w, h]);
    },
  };
}

function makeCanvas(draws: { count: number }): MinimapCanvasLike & {
  ctx: MinimapContextLike & { rects: number[][] };
} {
  const ctx = makeContext();
  return {
    ctx,
    width: 0,
    height: 0,
    getContext: () => {
      draws.count += 1;
      return ctx;
    },
  };
}

function makeDoc(draws: { count: number }): {
  doc: MinimapDocumentLike;
  canvas: MinimapCanvasLike & { ctx: MinimapContextLike & { rects: number[][] } };
} {
  const canvas = makeCanvas(draws);
  const doc: MinimapDocumentLike = {
    getElementById: (id: string) => (id === "minimap" ? canvas : null),
    createElement: () => makeCanvas(draws),
    body: { appendChild: () => {} },
  };
  ensureMinimap(doc);
  resetMinimapClock();
  return { doc, canvas };
}

describe("minimap projection", () => {
  it("reads (0,0) as (100,100)", () => {
    expect(projectToMap(0, 0)).toEqual({ px: 100, py: 100 });
    expect(project_to_map(0, 0)).toEqual({ px: 100, py: 100 });
  });

  it("normalizes (0,0) to (0.5,0.5)", () => {
    expect(normalizeMinimap(0, 0)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalize_minimap(0, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("keeps gate (68,68) inside the 0-200 face", () => {
    const p = projectToMap(68, 68);
    expect(p.px).toBeGreaterThan(0);
    expect(p.px).toBeLessThan(200);
    expect(p.py).toBeGreaterThan(0);
    expect(p.py).toBeLessThan(200);
    expect(p.px).toBeCloseTo(148.6, 0);
    expect(p.py).toBeCloseTo(148.6, 0);
  });

  it("maps corners (+/-140, +/-140) to the 0/200 edges", () => {
    expect(projectToMap(-140, -140)).toEqual({ px: 0, py: 0 });
    expect(projectToMap(140, 140)).toEqual({ px: 200, py: 200 });
    expect(projectToMap(-140, 140)).toEqual({ px: 0, py: 200 });
    expect(projectToMap(140, -140)).toEqual({ px: 200, py: 0 });
  });

  it("clamps off-track samples to the face edge", () => {
    expect(projectToMap(200, -200)).toEqual({ px: 200, py: 0 });
    expect(projectToMap(-999, 999)).toEqual({ px: 0, py: 200 });
  });

  it("is north-up: -Z rows above +Z rows", () => {
    const north = projectToMap(0, -140);
    const south = projectToMap(0, 140);
    expect(north.py).toBeLessThan(south.py);
  });

  it("never throws on non-finite input", () => {
    expect(() => projectToMap(NaN, Infinity)).not.toThrow();
    expect(() => normalizeMinimap(undefined, "x")).not.toThrow();
  });
});

describe("minimap constants", () => {
  it("pins the 200px face over the 140m half-extent", () => {
    expect(MAP_SIZE).toBe(200);
    expect(map_size).toBe(200);
    expect(HALF_EXTENT).toBe(140);
    expect(half_extent).toBe(140);
  });

  it("pins the dot sizes (4px gates/rivals, 6px player)", () => {
    expect(GATE_DOT).toBe(4);
    expect(gate_dot).toBe(4);
    expect(PLAYER_DOT).toBe(6);
    expect(player_dot).toBe(6);
    expect(RIVAL_DOT).toBe(4);
    expect(rival_dot).toBe(4);
  });

  it("pins the 10 Hz update interval with same-reference aliases", () => {
    expect(UPDATE_INTERVAL).toBe(0.1);
    expect(update_interval).toBe(0.1);
    expect(normalize_minimap).toBe(normalizeMinimap);
    expect(project_to_map).toBe(projectToMap);
    expect(ensure_minimap).toBe(ensureMinimap);
    expect(draw_minimap).toBe(drawMinimap);
    expect(update_minimap).toBe(updateMinimap);
    expect(reset_minimap_clock).toBe(resetMinimapClock);
  });
});

describe("minimap canvas ensure", () => {
  it("sets width/height 200 on the stub canvas", () => {
    const draws = { count: 0 };
    const { canvas } = makeDoc(draws);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(200);
  });

  it("creates the canvas when the document starts empty", () => {
    let created: unknown = null;
    const doc: MinimapDocumentLike = {
      getElementById: () => null,
      createElement: () => {
        created = { width: 0, height: 0 };
        return created;
      },
      body: { appendChild: () => {} },
    };
    const canvas = ensureMinimap(doc);
    expect(canvas).not.toBeNull();
    expect((created as { width: number }).width).toBe(200);
    expect((created as { height: number }).height).toBe(200);
  });

  it("returns null without a document and never throws", () => {
    expect(() => ensureMinimap(null)).not.toThrow();
  });
});

describe("minimap draw", () => {
  it("plots the player dot 6px at (100,100) for (0,0)", () => {
    const draws = { count: 0 };
    const { canvas } = makeDoc(draws);
    drawMinimap(canvas, { player: { x: 0, z: 0 }, rivals: [], gates: [] });
    const playerRects = canvas.ctx.rects.filter(
      (r) => r[2] === 6 && r[3] === 6,
    );
    expect(playerRects.length).toBe(1);
    expect(playerRects[0]?.[0]).toBeCloseTo(97, 0);
    expect(playerRects[0]?.[1]).toBeCloseTo(97, 0);
  });

  it("plots 4px gate and rival dots and skips bad entries", () => {
    const draws = { count: 0 };
    const { canvas } = makeDoc(draws);
    drawMinimap(canvas, {
      player: null,
      rivals: [{ x: 0, z: 0 }, null, 42, { x: NaN, z: 1 }],
      gates: [
        { x: -68, z: -68 },
        { x: 68, z: 68 },
        null,
        { x: "bad", z: 0 },
      ],
    });
    const small = canvas.ctx.rects.filter((r) => r[2] === 4 && r[3] === 4);
    // Two valid gates plus one valid rival.
    expect(small.length).toBe(3);
  });

  it("never throws on null canvas or snapshot", () => {
    expect(() => drawMinimap(null, null)).not.toThrow();
    expect(() => drawMinimap(undefined, undefined)).not.toThrow();
    expect(() => drawMinimap({}, { player: 42, rivals: 7, gates: "x" })).not.toThrow();
    expect(() =>
      drawMinimap({ width: 200, height: 200 }, { player: { x: 0, z: 0 } }),
    ).not.toThrow();
  });
});

describe("minimap 10 Hz throttle", () => {
  it("draws once per ten 1/60 updates, then again on 0.2", () => {
    const draws = { count: 0 };
    makeDoc(draws);
    const snapshot = { player: { x: 0, z: 0 }, rivals: [], gates: [] };
    for (let i = 0; i < 6; i++) {
      expect(updateMinimap(1 / 60, snapshot)).toBe(false);
    }
    expect(draws.count).toBe(0);
    expect(updateMinimap(1 / 60, snapshot)).toBe(true);
    expect(draws.count).toBe(1);
    for (let i = 0; i < 3; i++) {
      expect(updateMinimap(1 / 60, snapshot)).toBe(false);
    }
    expect(draws.count).toBe(1);
    expect(updateMinimap(0.2, snapshot)).toBe(true);
    expect(draws.count).toBe(2);
  });

  it("ignores non-finite and non-positive dt without drawing", () => {
    const draws = { count: 0 };
    makeDoc(draws);
    const snapshot = { player: { x: 0, z: 0 }, rivals: [], gates: [] };
    expect(updateMinimap(NaN, snapshot)).toBe(false);
    expect(updateMinimap(0, snapshot)).toBe(false);
    expect(updateMinimap(-1, snapshot)).toBe(false);
    expect(updateMinimap(Infinity, snapshot)).toBe(false);
    expect(draws.count).toBe(0);
  });

  it("restarts cold after resetMinimapClock", () => {
    const draws = { count: 0 };
    makeDoc(draws);
    const snapshot = { player: { x: 0, z: 0 }, rivals: [], gates: [] };
    updateMinimap(0.09, snapshot);
    resetMinimapClock();
    expect(updateMinimap(0.09, snapshot)).toBe(false);
    expect(draws.count).toBe(0);
  });
});

describe("minimap hygiene", () => {
  it("has no three.js or rapier imports", () => {
    const minimapPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "ui",
      "minimap.ts",
    );
    const text = readFileSync(minimapPath, "utf8");
    expect(text).not.toMatch(/three/);
    expect(text).not.toMatch(/rapier/i);
    expect(text).not.toMatch(/@dimforge/);
  });
});
