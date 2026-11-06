// Race-math contract suite: gate order wrap, progress standings, drift
// slide-vs-straight scoring, and time-trial delta formatting.
import { describe, expect, it } from "vitest";
import { nextIndex } from "../../src/race/order";
import { computePositions } from "../../src/race/positions";
import { scoreDrift } from "../../src/race/drift";
import { computeDelta, formatDelta } from "../../src/race/timetrial";

function gate(x: number, z: number): { x: number; y: number; z: number } {
  return { x, y: 1, z };
}

const SPRINT = {
  kind: "sprint",
  laps: 1,
  opponents: 3,
  reward: 500,
  mode: "race",
  checkpoints: [gate(0, 0), gate(10, 0), gate(20, 0), gate(30, 0), gate(40, 0)],
  checkpoint_radius: 10.0,
};

const CIRCUIT = {
  kind: "circuit",
  laps: 3,
  opponents: 3,
  reward: 500,
  mode: "race",
  checkpoints: [gate(0, 0), gate(10, 0), gate(10, 10), gate(0, 10)],
  checkpoint_radius: 10.0,
};

describe("race order contract", () => {
  it("advances sprint gates and finishes past the last", () => {
    expect(nextIndex(-1, SPRINT)).toBe(0);
    expect(nextIndex(0, SPRINT)).toBe(1);
    expect(nextIndex(4, SPRINT)).toBe(-1);
  });

  it("wraps circuit gates back to the start", () => {
    expect(nextIndex(3, CIRCUIT)).toBe(0);
    expect(nextIndex(0, CIRCUIT)).toBe(1);
  });
});

describe("race positions contract", () => {
  it("ranks 90 m ahead of 50 m with leader 0 and order [0, 1]", () => {
    const result = computePositions([90, 50]);
    expect(result.leader).toBe(0);
    expect(result.order).toEqual([0, 1]);
  });

  it("ranks the trailing field behind the leader", () => {
    const result = computePositions([10, 90, 50]);
    expect(result.leader).toBe(1);
    expect(result.order).toEqual([1, 2, 0]);
  });
});

describe("race drift contract", () => {
  it("scores a slide and ignores a straight", () => {
    const slide = scoreDrift(0.25, 15, 1 / 60);
    expect(slide).toBeGreaterThan(0);
    expect(scoreDrift(0.01, 15, 1 / 60)).toBe(0);
    expect(scoreDrift(0.25, 2, 1 / 60)).toBe(0);
  });
});

describe("race timetrial contract", () => {
  it("deltas race minus best with signed formatting", () => {
    expect(computeDelta(95.5, 93.0)).toBeCloseTo(2.5, 6);
    expect(computeDelta(90.0, 93.0)).toBeCloseTo(-3.0, 6);
    expect(formatDelta(2.5)).toContain("+");
    expect(formatDelta(-3.0).startsWith("-")).toBe(true);
  });
});
