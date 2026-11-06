// Tunes contract suite: the four Appendix-B cars, getTune lookup,
// stock-green validation, one-bad-bound red per dimension.
import { describe, expect, it } from "vitest";
import {
  ENGINE_TORQUE_MAX,
  ENGINE_TORQUE_MIN,
  TUNES,
  getTune,
  validateTune,
} from "../../src/data/tunes";

describe("tunes roster contract", () => {
  it("ships the four Appendix-B cars", () => {
    expect(Object.keys(TUNES).sort()).toEqual(["awd", "coupe", "hatch", "sedan"]);
  });

  it("resolves the sedan tune", () => {
    expect(getTune("sedan")?.engine_torque).toBe(380);
    expect(TUNES.sedan.drivetrain).toBe("RWD");
  });
});

describe("tunes validation contract", () => {
  it("passes every stock tune", () => {
    for (const tune of Object.values(TUNES)) {
      expect(validateTune(tune)).toBe(true);
    }
  });

  it("rejects one bad bound per dimension", () => {
    expect(validateTune({ ...TUNES.sedan, engine_torque: ENGINE_TORQUE_MIN - 1 })).toBe(false);
    expect(validateTune({ ...TUNES.sedan, engine_torque: ENGINE_TORQUE_MAX + 1 })).toBe(false);
    expect(validateTune({ ...TUNES.sedan, drivetrain: "4WD" })).toBe(false);
    const flat = [3.2, 3.2, 1.5, 1.1, 0.85];
    expect(validateTune({ ...TUNES.sedan, gear_ratios: flat, gears: [...flat] })).toBe(false);
  });

  it("stays inside the Appendix-B torque bounds", () => {
    for (const tune of Object.values(TUNES)) {
      expect(tune.engine_torque).toBeGreaterThanOrEqual(ENGINE_TORQUE_MIN);
      expect(tune.engine_torque).toBeLessThanOrEqual(ENGINE_TORQUE_MAX);
    }
  });
});
