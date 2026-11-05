// Race-math acceptance suite (positions_sort_by_progress,
// test_wrong_way_detected, drift_scores_slide_not_straight and
// timetrial_hud_delta_formats idioms). Covers the issue contract with no
// padding: 90-vs-50 positions, circuit wrap vs sprint finish, wrong-way
// skip/expected/duplicate, velocity direction, segment projection, drift
// gates, TT delta/format, reward bounds, and a static scan proving the
// race modules carry no three.js import.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  completesLap,
  completes_lap,
  isCorrectHit,
  isMovingWrongWay,
  isWrongWay,
  is_correct_hit,
  is_wrong_way,
  nextIndex,
  next_index,
  validateEvent,
  validateReward,
} from "../src/race/order";
import {
  RaceResults,
  computePositions,
  fractionToNext,
  fraction_to_next,
  progress,
  standingsFor,
  standings_for,
} from "../src/race/positions";
import {
  MIN_SLIP_DEG,
  MIN_SPEED_MS,
  SCORE_FACTOR,
  scoreDelta,
  scoreDrift,
  score_delta,
} from "../src/race/drift";
import {
  computeDelta,
  compute_delta,
  formatDelta,
  formatTime,
  format_delta,
  isValidReward,
} from "../src/race/timetrial";

const raceDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "race");

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

describe("positions", () => {
  it("ranks 90m ahead of 50m with leader index 0 and order [0,1]", () => {
    const result = computePositions([90, 50]);
    expect(result.leader).toBe(0);
    expect(result.order).toEqual([0, 1]);
  });

  it("ranks the trailing racer last when the order flips", () => {
    const result = computePositions([50, 90]);
    expect(result.leader).toBe(1);
    expect(result.order).toEqual([1, 0]);
  });

  it("breaks progress ties by lower input index", () => {
    const total = CIRCUIT.checkpoints.length;
    const tied = standingsFor([
      { id: "a", progress: 5.0 },
      { id: "b", progress: 5.0 },
      { id: "c", progress: 6.0 },
    ]);
    expect(tied.map((e) => e.id)).toEqual(["c", "a", "b"]);
    expect(standings_for(tied).map((e) => e.id)).toEqual(["c", "a", "b"]);
    expect(progress(0, 1, -0.5, total)).toBe(progress(0, 1, 0.0, total));
    expect(progress(0, 1, 2.0, total)).toBe(progress(0, 1, 1.0, total));
    expect(progress(0, -1, 0.5, total)).toBeLessThan(progress(0, 0, 0.0, total));
  });

  it("holds every finisher with places in the results table", () => {
    const table = new RaceResults();
    table.recordFinish("player", 88.2);
    table.record_finish("ai_1", 91.0);
    expect(table.size()).toBe(2);
    expect(table.placeOf("player")).toBe(1);
    expect(table.place_of("ai_1")).toBe(2);
    expect(table.recordFinish("player", 70.0)).toBe(1);
    expect(table.recordFinish("ghost", -5.0)).toBe(0);
    expect(table.size()).toBe(2);
  });
});

describe("gate order", () => {
  it("wraps a circuit to gate 0 and finishes a sprint with -1", () => {
    const last = CIRCUIT.checkpoints.length - 1;
    expect(nextIndex(last, CIRCUIT)).toBe(0);
    expect(next_index(last, CIRCUIT)).toBe(0);
    expect(nextIndex(SPRINT.checkpoints.length - 1, SPRINT)).toBe(-1);
  });

  it("flags a skip as wrong-way but not the expected gate or a duplicate", () => {
    expect(isWrongWay(2, -1, CIRCUIT)).toBe(true);
    expect(isWrongWay(0, -1, CIRCUIT)).toBe(false);
    expect(isWrongWay(0, 0, CIRCUIT)).toBe(false);
    expect(is_wrong_way(2, -1, CIRCUIT)).toBe(true);
    expect(isCorrectHit(0, -1, CIRCUIT)).toBe(true);
    expect(is_correct_hit(2, -1, CIRCUIT)).toBe(false);
    expect(completesLap(3, 2, CIRCUIT)).toBe(true);
    expect(completes_lap(4, 3, SPRINT)).toBe(false);
  });

  it("validates stock shapes and rejects bad laps", () => {
    expect(validateEvent(SPRINT)).toBe(true);
    expect(validateEvent(CIRCUIT)).toBe(true);
    expect(validateEvent({ ...CIRCUIT, laps: 99 })).toBe(false);
    expect(validateEvent({ ...SPRINT, laps: 2 })).toBe(false);
  });
});

describe("wrong-way velocity", () => {
  it("flags driving away but not toward or standstill", () => {
    const car = { x: 0, z: 0 };
    const next = { x: 10, z: 0 };
    expect(isMovingWrongWay({ x: -5, z: 0 }, car, next)).toBe(true);
    expect(isMovingWrongWay({ x: 5, z: 0 }, car, next)).toBe(false);
    expect(isMovingWrongWay({ x: 0, z: 0 }, car, next)).toBe(false);
  });

  it("projects mid-segment to 0.5 and degenerate segments to 0.0", () => {
    const prev = { x: 0, z: 0 };
    const next = { x: 10, z: 0 };
    expect(fractionToNext({ x: 5, z: 0 }, prev, next)).toBeCloseTo(0.5, 6);
    expect(fraction_to_next({ x: 5, z: 0 }, prev, prev)).toBe(0.0);
  });
});

describe("drift scoring", () => {
  it("pins the v1 gates and factor", () => {
    expect(MIN_SLIP_DEG).toBe(12.0);
    expect(MIN_SPEED_MS).toBe(10.0);
    expect(SCORE_FACTOR).toBe(1.0);
  });

  it("scores a 0.25rad slide at 12m/s but not at 5m/s", () => {
    expect(scoreDrift(0.25, 12, 1)).toBeGreaterThan(0);
    expect(scoreDrift(0.25, 5, 1)).toBe(0);
    expect(scoreDelta(20.0, 20.0, 1.0)).toBe(400.0);
    expect(score_delta(5.0, 20.0, 1.0)).toBe(0.0);
    expect(scoreDelta(20.0, 20.0, 0.0)).toBe(0.0);
  });
});

describe("time trial", () => {
  it("computes a signed delta with millisecond precision", () => {
    expect(computeDelta(93.241, 95.0)).toBeCloseTo(-1.759, 3);
    expect(compute_delta(89.5, 90.0)).toBeCloseTo(-0.5, 6);
  });

  it("formats the delta with sign and 1.759 milliseconds", () => {
    const delta = formatDelta(93.241 - 95.0);
    expect(delta).toMatch(/[+-].*1\.759/);
    expect(format_delta(-0.5)).toBe("-00:00.500");
    expect(formatDelta(1.2)).toBe("+00:01.200");
    expect(formatTime(65.5)).toBe("01:05.500");
  });

  it("accepts reward 5000 and rejects 5001", () => {
    expect(isValidReward(5000)).toBe(true);
    expect(isValidReward(5001)).toBe(false);
    expect(validateReward(0)).toBe(true);
    expect(validateReward(-1)).toBe(false);
  });
});

describe("race hygiene", () => {
  it("has no three.js imports", () => {
    for (const file of ["order.ts", "positions.ts", "drift.ts", "timetrial.ts"]) {
      const text = readFileSync(join(raceDir, file), "utf8");
      expect(text).not.toMatch(/three/);
      expect(text).not.toMatch(/^\s*import\s/m);
    }
  });
});
