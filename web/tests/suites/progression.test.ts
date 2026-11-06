// Progression contract suite: ladder order, reward-car mapping, unlock
// predicates, and the applyResult round-trip (save.test.ts healing idiom).
import { afterEach, describe, expect, it } from "vitest";
import {
  LADDER,
  REWARD_CARS,
  applyResult,
  canUnlockNext,
  carReward,
  mappedCar,
  nextEventAfter,
} from "../../src/game/progression";
import { createMemoryStorage, defaultSave, loadSave, saveNow } from "../../src/game/save";

afterEach(() => {
  saveNow(defaultSave());
});

describe("progression ladder contract", () => {
  it("orders the six v1 rungs", () => {
    expect(LADDER).toEqual([
      "harbor_sprint",
      "downtown_gp",
      "neon_loop",
      "bayline_circuit",
      "alley_sprint",
      "drift_park",
    ]);
    expect(REWARD_CARS).toEqual(["coupe", "hatch", "awd"]);
  });

  it("maps each rung to its reward car", () => {
    expect(mappedCar("harbor_sprint")).toBe("coupe");
    expect(mappedCar("downtown_gp")).toBe("hatch");
    expect(mappedCar("neon_loop")).toBe("awd");
    expect(mappedCar("drift_park")).toBe("awd");
    expect(mappedCar("bogus_event")).toBe("");
  });

  it("steps to the next rung, empty past the final", () => {
    expect(nextEventAfter("harbor_sprint")).toBe("downtown_gp");
    expect(nextEventAfter("alley_sprint")).toBe("drift_park");
    expect(nextEventAfter("drift_park")).toBe("");
    expect(nextEventAfter("bogus_event")).toBe("");
  });
});

describe("progression predicate contract", () => {
  it("accepts the issue acceptance pair", () => {
    expect(canUnlockNext("harbor_sprint", 3)).toBe(true);
    expect(carReward("downtown_gp", 1)).toBe(true);
  });

  it("rejects out-of-range places and unknown events", () => {
    expect(canUnlockNext("harbor_sprint", 5)).toBe(false);
    expect(canUnlockNext("harbor_sprint", 0)).toBe(false);
    expect(canUnlockNext("bogus_event", 1)).toBe(false);
    expect(carReward("downtown_gp", 3)).toBe(false);
    expect(carReward("bogus_event", 1)).toBe(false);
  });
});

describe("progression unlock round-trip", () => {
  it("a win grants the mapped car and opens the next rung", () => {
    const storage = createMemoryStorage();
    const win = applyResult("harbor_sprint", 1, storage);
    expect(win.unlockedCars).toContain("coupe");
    expect(win.carUnlocked).toBe("coupe");
    expect(win.eventUnlocked).toBe("downtown_gp");
    expect(loadSave(storage).progress.unlocked_cars).toContain("coupe");
  });

  it("place 5 changes nothing", () => {
    const storage = createMemoryStorage();
    const noop = applyResult("harbor_sprint", 5, storage);
    expect(noop.eventUnlocked).toBe("");
    expect(noop.carUnlocked).toBe("");
  });
});
