// Data acceptance suite (test_event_select_grid_skips_invalid idiom:
// duplicate-mutate-reject). Covers the issue contract with no padding:
// roster sizes and ported Appendix A/B values, validators green on stock
// data and red on one bad-bound mutation per dimension, and a static scan
// proving the data modules carry no three.js import.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVENTS, events, getEvent, validateEvent } from "../src/data/events";
import { LANE_LOOPS, TRAFFIC_TUNING, validateLaneLoop } from "../src/data/lanePaths";
import { TUNES, getTune, validateTune } from "../src/data/tunes";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");

describe("event data", () => {
  it("exports 6 events", () => {
    expect(EVENTS).toHaveLength(6);
    expect(events).toHaveLength(6);
  });

  it("harbor_sprint has 5 checkpoints and radius 10.0", () => {
    const harbor = getEvent("harbor_sprint");
    expect(harbor).toBeDefined();
    expect(harbor?.checkpoints).toHaveLength(5);
    expect(harbor?.gates).toHaveLength(5);
    expect(harbor?.checkpoint_radius).toBe(10.0);
    expect(harbor?.radius).toBe(10.0);
  });

  it("validates downtown_gp and rejects a 2-gate copy", () => {
    const downtown = getEvent("downtown_gp");
    expect(downtown).toBeDefined();
    expect(validateEvent(downtown)).toBe(true);
    const badGates =
      downtown === undefined
        ? undefined
        : {
            ...downtown,
            checkpoints: [
              { x: 0, y: 1, z: 0 },
              { x: 10, y: 1, z: 0 },
            ],
          };
    expect(validateEvent(badGates)).toBe(false);
  });

  it("passes every stock event", () => {
    for (const event of EVENTS) {
      expect(validateEvent(event)).toBe(true);
    }
  });

  it("rejects bad laps", () => {
    const downtown = getEvent("downtown_gp");
    expect(validateEvent({ ...downtown, laps: 99 })).toBe(false);
  });

  it("rejects an out-of-range radius", () => {
    const harbor = getEvent("harbor_sprint");
    expect(validateEvent({ ...harbor, checkpoint_radius: 99.0, radius: 99.0 })).toBe(false);
  });
});

describe("tune data", () => {
  it("sedan carries engine_torque 380 and drivetrain RWD", () => {
    expect(TUNES.sedan.engine_torque).toBe(380);
    expect(TUNES.sedan.drivetrain).toBe("RWD");
    expect(getTune("sedan")?.engine_torque).toBe(380);
  });

  it("passes every stock tune", () => {
    for (const tune of Object.values(TUNES)) {
      expect(validateTune(tune)).toBe(true);
    }
  });

  it("rejects bad torque", () => {
    expect(validateTune({ ...TUNES.sedan, engine_torque: 99 })).toBe(false);
  });

  it("rejects non-decreasing gears", () => {
    const gears = [3.2, 3.2, 1.5, 1.1, 0.85];
    expect(
      validateTune({ ...TUNES.sedan, gear_ratios: gears, gears: [...gears] }),
    ).toBe(false);
  });

  it("rejects a bad drivetrain", () => {
    expect(validateTune({ ...TUNES.sedan, drivetrain: "4WD" })).toBe(false);
  });
});

describe("lane data", () => {
  it("exports 3 valid closed loops", () => {
    expect(LANE_LOOPS).toHaveLength(3);
    for (const loop of LANE_LOOPS) {
      expect(validateLaneLoop(loop)).toBe(true);
    }
  });

  it("carries the ported traffic tuning", () => {
    expect(TRAFFIC_TUNING.count).toBe(6);
    expect(TRAFFIC_TUNING.cruise).toBe(9.0);
    expect(TRAFFIC_TUNING.accel).toBe(6.0);
    expect(TRAFFIC_TUNING.brake).toBe(12.0);
    expect(TRAFFIC_TUNING.recycleDistance).toBe(150.0);
    expect(TRAFFIC_TUNING.respawnAhead).toBe(30.0);
  });

  it("rejects an out-of-extent loop", () => {
    const loop = LANE_LOOPS[0];
    const bad = {
      ...loop,
      points: [...loop.points, { x: 999, y: 0.6, z: 0 }],
    };
    expect(validateLaneLoop(bad)).toBe(false);
  });

  it("rejects an open loop", () => {
    expect(validateLaneLoop({ ...LANE_LOOPS[1], closed: false })).toBe(false);
  });
});

describe("data hygiene", () => {
  it("has no three.js imports", () => {
    for (const file of ["events.ts", "tunes.ts", "lanePaths.ts"]) {
      const text = readFileSync(join(dataDir, file), "utf8");
      expect(text).not.toMatch(/three/);
      expect(text).not.toMatch(/^\s*import\s/m);
    }
  });
});
