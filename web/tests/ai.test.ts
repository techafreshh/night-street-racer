// AI racing-line acceptance suite (bakeRacingLine clamp, rubberBand cap,
// aiInput pursuit idioms). Covers the issue contract with no padding: loop
// bake within 8-28 m/s, +50 m gap capped at +3 m/s, straight-line pursuit
// at 10 m/s, plus unit gates (straight curvature, open-line braking,
// negative-gap cap, deadband coast, lookahead endpoints, braking side) and
// a static scan proving the AI modules carry no three.js import.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BRAKE_DECEL,
  GRIP_BUDGET,
  LATERAL_ACCEL,
  MAX_SPEED,
  MIN_SPEED,
  arcOf,
  arc_of,
  bakeRacingLine,
  bake_racing_line,
  bakeSpeeds,
  bake_speeds,
  closestIndex,
  curvatureOf,
  curvature_of,
  lookaheadPoint,
  pointAtArc,
  rawSpeed,
  raw_speed,
  speedAtArc,
  throttleCap,
  throttle_cap,
  trackLength,
} from "../src/ai/racing_line";
import { aiInput, ai_input, lookaheadFor, lookahead_for } from "../src/ai/ai_input";
import {
  GAIN,
  MAX_AID,
  computeAid,
  compute_aid,
  rubberBand,
  rubber_band,
  wrapGap,
  wrap_gap,
} from "../src/ai/rubber_band";

const aiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ai");

// Mixed straight/curve loop: long straights read the 28 top speed while
// the tight corners bake down toward (but never below) 8 m/s.
const TEST_LOOP = [
  { x: 0, z: 0 },
  { x: 50, z: 0 },
  { x: 60, z: 10 },
  { x: 60, z: 40 },
  { x: 50, z: 50 },
  { x: 0, z: 50 },
  { x: -10, z: 40 },
  { x: -10, z: 10 },
];

describe("racing line bake", () => {
  it("keeps every target speed within 8-28 m/s on the test loop", () => {
    const speeds = bakeRacingLine(TEST_LOOP);
    expect(speeds.length).toBe(TEST_LOOP.length);
    for (const v of speeds) {
      expect(v).toBeGreaterThanOrEqual(8);
      expect(v).toBeLessThanOrEqual(28);
    }
  });

  it("pins the v1 budget defaults and alias references", () => {
    expect(MIN_SPEED).toBe(8.0);
    expect(MAX_SPEED).toBe(28.0);
    expect(LATERAL_ACCEL).toBe(7.0);
    expect(BRAKE_DECEL).toBe(6.0);
    expect(bake_racing_line).toBe(bakeRacingLine);
    expect(bake_speeds).toBe(bakeSpeeds);
    expect(bakeSpeeds).toBe(bakeRacingLine);
    expect(curvature_of).toBe(curvatureOf);
    expect(raw_speed).toBe(rawSpeed);
    expect(arc_of).toBe(arcOf);
  });

  it("reads zero curvature on a straight", () => {
    const straight = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 20, z: 0 },
    ];
    expect(curvatureOf(straight, 1, false)).toBe(0);
    expect(rawSpeed(0)).toBe(MAX_SPEED);
  });

  it("brakes before the corner on an open line", () => {
    const open = [
      { x: 0, z: 0 },
      { x: 30, z: 0 },
      { x: 31, z: 1 },
      { x: 31, z: 10 },
    ];
    const speeds = bakeRacingLine(open, false);
    expect(speeds.length).toBe(open.length);
    for (let i = 0; i < speeds.length - 1; i += 1) {
      const a = open[i];
      const b = open[i + 1];
      const ds = Math.hypot(b.x - a.x, b.z - a.z);
      const allow = Math.sqrt(speeds[i + 1] * speeds[i + 1] + 2 * 6 * ds);
      expect(speeds[i]).toBeLessThanOrEqual(allow + 1e-6);
    }
  });

  it("projects arcs and lookaheads on the loop", () => {
    const total = trackLength(TEST_LOOP);
    expect(total).toBeGreaterThan(0);
    const arc = arcOf(TEST_LOOP, { x: 25, z: 0 });
    expect(arc).toBeGreaterThanOrEqual(0);
    expect(arc).toBeLessThanOrEqual(total);
    const look = lookaheadPoint(TEST_LOOP, { x: 25, z: 0 }, 10);
    expect(Number.isFinite(look.x)).toBe(true);
    expect(Number.isFinite(look.z)).toBe(true);
    expect(closestIndex(TEST_LOOP, { x: 0, z: 0 })).toBe(0);
    const speeds = bakeRacingLine(TEST_LOOP);
    const atArc = speedAtArc(TEST_LOOP, speeds, arc);
    expect(atArc).toBeGreaterThanOrEqual(8);
    expect(atArc).toBeLessThanOrEqual(28);
    expect(pointAtArc(TEST_LOOP, 0).x).toBeCloseTo(TEST_LOOP[0].x, 6);
  });
});

describe("rubber band", () => {
  it("caps a +50 m gap at +3 m/s", () => {
    expect(rubberBand(50)).toBe(3);
  });

  it("caps a -50 m gap at -3 m/s and pins the budgets", () => {
    expect(rubberBand(-50)).toBe(-3);
    expect(MAX_AID).toBe(3.0);
    expect(GAIN).toBe(0.08);
    expect(rubber_band).toBe(rubberBand);
    expect(compute_aid).toBe(computeAid);
    expect(computeAid(10)).toBeCloseTo(0.8, 6);
    expect(computeAid(50, 3, 0.08)).toBe(3);
  });

  it("reads zero for non-finite gaps and disabled aids", () => {
    expect(rubberBand(NaN)).toBe(0);
    expect(computeAid({ gap: 50, enabled: false })).toBe(0);
    expect(wrap_gap).toBe(wrapGap);
    expect(wrapGap(110, 10, 100)).toBeCloseTo(0, 6);
    expect(wrapGap(60, 10, 100)).toBeCloseTo(50, 6);
  });
});

describe("pursuit input", () => {
  it("drives forward on a straight at 10 m/s aligned", () => {
    const out = aiInput({ speedMs: 10, angle: 0, yawRate: 0, targetSpeed: 28 });
    expect(out.throttle).toBeGreaterThan(0.3);
    expect(Math.abs(out.steer)).toBeLessThan(0.2);
    expect(ai_input).toBe(aiInput);
  });

  it("reaches the same verdict without an explicit target", () => {
    const out = aiInput({ speedMs: 10, angle: 0, yawRate: 0 });
    expect(out.throttle).toBeGreaterThan(0.3);
    expect(Math.abs(out.steer)).toBeLessThan(0.2);
  });

  it("coasts inside the deadband and brakes below it", () => {
    const coast = aiInput({ speedMs: 10, angle: 0, yawRate: 0, targetSpeed: 10.2 });
    expect(coast.throttle).toBe(0);
    expect(coast.brake).toBe(0);
    const braking = aiInput({ speedMs: 20, angle: 0, yawRate: 0, targetSpeed: 10 });
    expect(braking.brake).toBeGreaterThan(0);
    expect(braking.throttle).toBe(0);
  });

  it("clamps the lookahead to 4-16 m", () => {
    expect(lookaheadFor(0)).toBe(4);
    expect(lookaheadFor(30)).toBe(16);
    expect(lookaheadFor(10)).toBeCloseTo(9, 6);
    expect(lookahead_for).toBe(lookaheadFor);
  });
});

describe("throttle cap", () => {
  it("matches the Godot throttle_cap curve with a 0.25 floor", () => {
    expect(GRIP_BUDGET).toBe(9.0);
    expect(throttleCap(0)).toBe(1);
    expect(throttleCap(4.5)).toBeCloseTo(0.5, 6);
    expect(throttleCap(9)).toBe(0.25);
    expect(throttleCap(20)).toBe(0.25);
    expect(throttleCap(NaN)).toBe(1);
    expect(throttle_cap).toBe(throttleCap);
  });

  it("leaves straight-line pursuit uncapped", () => {
    const out = aiInput({ speedMs: 10, angle: 0, yawRate: 0, targetSpeed: 28 });
    expect(out.throttle).toBeGreaterThan(0.3);
    expect(out.throttle).toBeCloseTo(1, 6);
  });

  it("caps a high-yaw flat call that previously returned full throttle", () => {
    const out = aiInput({ speedMs: 20, angle: 0, yawRate: 1.5, targetSpeed: 28 });
    expect(out.throttle).toBeLessThan(1);
    expect(out.throttle).toBeCloseTo(0.25, 6);
  });

  it("caps end-to-end corner geometry at speed", () => {
    const tight = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ];
    const out = aiInput({
      speedMs: 20,
      angle: 0,
      yawRate: 0,
      targetSpeed: 28,
      points: tight,
      carPos: { x: 10, z: 0 },
    });
    expect(out.throttle).toBeLessThan(1);
    expect(out.throttle).toBeCloseTo(0.25, 6);
  });
});

describe("ai hygiene", () => {
  it("has no three.js imports", () => {
    for (const file of readdirSync(aiDir).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join(aiDir, file), "utf8");
      expect(text).not.toMatch(/three/);
      expect(text).not.toMatch(/^\s*import\s/m);
    }
  });
});
