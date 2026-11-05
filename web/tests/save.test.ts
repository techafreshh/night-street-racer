// Save/progression acceptance suite (test_save.gd probe idiom:
// seed raw JSON, load, check, restore defaults). Covers the issue #207
// contract with no padding: schema constants plus defaults, strict
// validation, lenient-load clamping/dropping, unlock round-trips,
// canUnlockNext/carReward true/false matrix, coalesced writes plus flush,
// PRD section 10 settings defaults, records merge rules, and state
// selection round-trips. Mutating shared-storage tests restore defaults.

import { afterEach, describe, expect, it } from "vitest";
import {
  SAVE_KEY,
  SAVE_VERSION,
  SCHEMA_VERSION,
  createMemoryStorage,
  defaultData,
  defaultSave,
  loadGame,
  loadSave,
  saveGame,
  saveNow,
  validate,
  validateSave,
  type StorageAdapter,
} from "../src/game/save";
import {
  LADDER,
  REWARD_CARS,
  applyResult,
  canUnlockNext,
  carReward,
  mappedCar,
  nextEventAfter,
} from "../src/game/progression";
import { GameState } from "../src/game/state";
import { SettingsStore } from "../src/game/settings";

function isolated(): StorageAdapter {
  return createMemoryStorage();
}

function seedRaw(storage: StorageAdapter, raw: unknown): void {
  storage.setItem(SAVE_KEY, JSON.stringify(raw));
}

function storedJson(storage: StorageAdapter): string {
  return storage.getItem(SAVE_KEY) as string;
}

// Every shared-storage mutation is healed so later suites start clean.
afterEach(() => {
  saveNow(defaultSave());
});

describe("save schema", () => {
  it("uses the nsr_save key with schema version 1", () => {
    expect(SAVE_KEY).toBe("nsr_save");
    expect(SAVE_VERSION).toBe(1);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("godot-name aliases share the same reference", () => {
    expect(defaultData).toBe(defaultSave);
    expect(validate).toBe(validateSave);
    expect(loadGame).toBe(loadSave);
    expect(saveGame).toBe(saveNow);
  });

  it("defaults validate and stay fresh per call", () => {
    const first = defaultSave();
    expect(validateSave(first)).toBe(true);
    first.progress.selected_car = "hatch";
    first.settings.master_volume = 0.1;
    const second = defaultSave();
    expect(second.progress.selected_car).toBe("");
    expect(second.settings.master_volume).toBe(0.8);
  });

  it("carries the PRD section 10 defaults", () => {
    const fresh = defaultSave();
    expect(fresh.settings).toEqual({
      master_volume: 0.8,
      music_volume: 0.7,
      sfx_volume: 0.9,
      assists: true,
      camera_shake: true,
    });
    expect(fresh.progress.selected_car).toBe("");
    expect(fresh.progress.selected_color).toBe(0);
    expect(fresh.progress.current_event).toBe("");
    expect(fresh.progress.unlocked_events).toEqual([]);
    expect(fresh.progress.unlocked_cars).toEqual([]);
    expect(fresh.records).toEqual({});
  });
});

describe("round-trip persistence", () => {
  it("saves unlocked_events and reloads version 1 with the same event", () => {
    const storage = isolated();
    const doc = defaultSave();
    doc.progress.unlocked_events = ["harbor_sprint"];
    expect(saveNow(doc, storage)).toBe(true);
    const raw = storedJson(storage);
    expect(raw).toContain('"version":1');
    expect(raw).toContain("harbor_sprint");
    const loaded = loadSave(storage);
    expect(loaded.version).toBe(1);
    expect(loaded.progress.unlocked_events).toEqual(["harbor_sprint"]);
    expect(validateSave(loaded)).toBe(true);
  });

  it("missing storage falls back to valid defaults", () => {
    const loaded = loadSave(isolated());
    expect(validateSave(loaded)).toBe(true);
    expect(loaded).toEqual(defaultSave());
  });

  it("corrupt JSON falls back to valid defaults", () => {
    const storage = isolated();
    storage.setItem(SAVE_KEY, "{not valid json!!!");
    const loaded = loadSave(storage);
    expect(validateSave(loaded)).toBe(true);
    expect(loaded).toEqual(defaultSave());
  });

  it("a numeric future version carries through as int", () => {
    const storage = isolated();
    const doc = defaultSave();
    doc.version = SAVE_VERSION + 1;
    doc.progress.selected_car = "coupe";
    expect(saveNow(doc, storage)).toBe(true);
    const loaded = loadSave(storage);
    expect(loaded.version).toBe(SAVE_VERSION + 1);
    expect(loaded.progress.selected_car).toBe("coupe");
    expect(validateSave(loaded)).toBe(false);
  });
});

describe("corrupt-load clamping and dropping", () => {
  it("drops unknown keys and clamps master_volume 2 to 1", () => {
    const storage = isolated();
    seedRaw(storage, {
      version: 1,
      settings: { master_volume: 2, bogus_key: 123 },
      progress: {
        unlocked_events: ["harbor_sprint"],
        bogus_key: true,
      },
      records: {},
      achievements_seen: true,
    });
    const loaded = loadSave(storage);
    expect(loaded.settings.master_volume).toBe(1);
    expect(loaded.settings).not.toHaveProperty("bogus_key");
    expect(Object.keys(loaded.settings)).toHaveLength(5);
    expect(loaded.progress).not.toHaveProperty("bogus_key");
    expect(loaded).not.toHaveProperty("achievements_seen");
    expect(Object.keys(loaded)).toHaveLength(4);
    expect(loaded.progress.unlocked_events).toEqual(["harbor_sprint"]);
    expect(validateSave(loaded)).toBe(true);
  });

  it("sanitizes dirty unlock lists to non-empty strings", () => {
    const storage = isolated();
    seedRaw(storage, {
      version: 1,
      settings: defaultSave().settings,
      progress: {
        unlocked_events: ["harbor_sprint", "", 42, null, "downtown_gp"],
        unlocked_cars: "coupe",
        selected_car: "",
        selected_color: 0,
        current_event: "",
      },
      records: {},
    });
    const loaded = loadSave(storage);
    expect(loaded.progress.unlocked_events).toEqual([
      "harbor_sprint",
      "downtown_gp",
    ]);
    expect(loaded.progress.unlocked_cars).toEqual([]);
    expect(validateSave(loaded)).toBe(true);
  });
});

describe("strict validation", () => {
  it("rejects bad versions", () => {
    for (const version of [2, 0, true, "1", 1.5, null]) {
      const doc = defaultSave() as unknown as Record<string, unknown>;
      doc.version = version;
      expect(validateSave(doc)).toBe(false);
    }
    const missing = defaultSave() as unknown as Record<string, unknown>;
    delete missing.version;
    expect(validateSave(missing)).toBe(false);
  });

  it("rejects unknown or bad settings keys", () => {
    const bogus = defaultSave();
    (bogus.settings as unknown as Record<string, unknown>).bogus_key = 123;
    expect(validateSave(bogus)).toBe(false);
    for (const key of ["master_volume", "music_volume", "sfx_volume"] as const) {
      const loud = defaultSave();
      loud.settings[key] = 2;
      expect(validateSave(loud)).toBe(false);
      const text = defaultSave();
      (text.settings as unknown as Record<string, unknown>)[key] = "loud";
      expect(validateSave(text)).toBe(false);
    }
    const missing = defaultSave();
    delete (missing.settings as unknown as Record<string, unknown>)
      .sfx_volume;
    expect(validateSave(missing)).toBe(false);
    const badFlag = defaultSave();
    (badFlag.settings as unknown as Record<string, unknown>).assists = 1;
    expect(validateSave(badFlag)).toBe(false);
  });

  it("rejects bad progress selections and unlock lists", () => {
    const badCar = defaultSave();
    (badCar.progress as unknown as Record<string, unknown>).selected_car = 42;
    expect(validateSave(badCar)).toBe(false);
    const badColor = defaultSave();
    (badColor.progress as unknown as Record<string, unknown>).selected_color =
      "red";
    expect(validateSave(badColor)).toBe(false);
    const floatColor = defaultSave();
    floatColor.progress.selected_color = 2;
    expect(validateSave(floatColor)).toBe(true);
    const badList = defaultSave();
    (badList.progress as unknown as Record<string, unknown>).unlocked_events =
      "harbor_sprint";
    expect(validateSave(badList)).toBe(false);
    const badEntry = defaultSave();
    badEntry.progress.unlocked_cars = [""];
    expect(validateSave(badEntry)).toBe(false);
  });

  it("validates records entries field by field", () => {
    const good = defaultSave();
    good.records.harbor_sprint = { best_time_s: 93.24, best_position: 1 };
    expect(validateSave(good)).toBe(true);
    const frac = defaultSave();
    frac.records.harbor_sprint = { best_time_s: 90, best_position: 1.5 };
    expect(validateSave(frac)).toBe(false);
    const empty = defaultSave();
    empty.records.harbor_sprint = {};
    expect(validateSave(empty)).toBe(false);
    const emptyKey = defaultSave();
    emptyKey.records[""] = { best_time_s: 80, best_position: 1 };
    expect(validateSave(emptyKey)).toBe(false);
  });
});

describe("records merge rules", () => {
  it("keeps valid entries, sanitizes them, and drops corrupt ones", () => {
    const storage = isolated();
    seedRaw(storage, {
      version: 1,
      settings: defaultSave().settings,
      progress: defaultSave().progress,
      records: {
        harbor_sprint: { best_time_s: 93.24, best_position: 1, note: "pb" },
        note_only: { note: "pb" },
        string_entry: "fast",
        empty_entry: {},
        bad_time_type: { best_time_s: "fast", best_position: 1 },
        frac_position: { best_time_s: 90, best_position: 1.5 },
        zero_time: { best_time_s: 0, best_position: 2 },
        "": { best_time_s: 80, best_position: 1 },
      },
    });
    const loaded = loadSave(storage);
    expect(validateSave(loaded)).toBe(true);
    expect(Object.keys(loaded.records)).toEqual(["harbor_sprint"]);
    expect(loaded.records.harbor_sprint).toEqual({
      best_time_s: 93.24,
      best_position: 1,
    });
  });
});

describe("progression predicates", () => {
  it("accepts the issue acceptance pair", () => {
    expect(canUnlockNext("harbor_sprint", 3)).toBe(true);
    expect(carReward("downtown_gp", 1)).toBe(true);
  });

  it("rejects out-of-range places and unknown events", () => {
    expect(canUnlockNext("harbor_sprint", 5)).toBe(false);
    expect(canUnlockNext("harbor_sprint", 0)).toBe(false);
    expect(canUnlockNext("harbor_sprint", 2.5)).toBe(false);
    expect(canUnlockNext("bogus_event", 1)).toBe(false);
    expect(canUnlockNext("harbor_sprint", "3")).toBe(false);
    expect(carReward("downtown_gp", 3)).toBe(false);
    expect(carReward("bogus_event", 1)).toBe(false);
    expect(carReward("downtown_gp", 1.5)).toBe(false);
  });

  it("opens no next rung on the final event but still grants its car", () => {
    expect(canUnlockNext("drift_park", 1)).toBe(false);
    expect(canUnlockNext("drift_park", 3)).toBe(false);
    expect(carReward("drift_park", 1)).toBe(true);
    expect(nextEventAfter("drift_park")).toBe("");
    expect(nextEventAfter("alley_sprint")).toBe("drift_park");
    expect(nextEventAfter("bogus_event")).toBe("");
  });

  it("maps the clamped reward table", () => {
    expect(LADDER).toEqual([
      "harbor_sprint",
      "downtown_gp",
      "neon_loop",
      "bayline_circuit",
      "alley_sprint",
      "drift_park",
    ]);
    expect(REWARD_CARS).toEqual(["coupe", "hatch", "awd"]);
    expect(mappedCar("harbor_sprint")).toBe("coupe");
    expect(mappedCar("downtown_gp")).toBe("hatch");
    expect(mappedCar("neon_loop")).toBe("awd");
    expect(mappedCar("drift_park")).toBe("awd");
    expect(mappedCar("bogus_event")).toBe("");
  });
});

describe("progression results", () => {
  it("top-3 opens the next rung with no car", () => {
    const storage = isolated();
    const p3 = applyResult("harbor_sprint", 3, storage);
    expect(p3.eventUnlocked).toBe("downtown_gp");
    expect(p3.unlockedEvents).toContain("harbor_sprint");
    expect(p3.carUnlocked).toBe("");
    expect(p3.unlockedCars).toEqual([]);
  });

  it("a win grants the mapped car and opens the next rung", () => {
    const storage = isolated();
    const win = applyResult("harbor_sprint", 1, storage);
    expect(win.unlockedCars).toContain("coupe");
    expect(win.carUnlocked).toBe("coupe");
    expect(win.eventUnlocked).toBe("downtown_gp");
    const p3 = applyResult("downtown_gp", 3, storage);
    expect(p3.eventUnlocked).toBe("neon_loop");
    expect(p3.carUnlocked).toBe("");
    const again = applyResult("harbor_sprint", 1, storage);
    expect(again.unlockedCars.filter((car) => car === "coupe")).toHaveLength(
      1,
    );
    expect(again.carUnlocked).toBe("");
  });

  it("place 5 and unknown events change nothing", () => {
    const storage = isolated();
    const before = applyResult("harbor_sprint", 1, storage);
    const noop = applyResult("harbor_sprint", 5, storage);
    expect(noop.eventUnlocked).toBe("");
    expect(noop.carUnlocked).toBe("");
    expect(noop.unlockedEvents).toEqual(before.unlockedEvents);
    const unknown = applyResult("bogus_event", 1, storage);
    expect(unknown.eventUnlocked).toBe("");
    expect(unknown.carUnlocked).toBe("");
  });

  it("the final rung grants a car but opens nothing", () => {
    const storage = isolated();
    const last = applyResult("drift_park", 1, storage);
    expect(last.eventUnlocked).toBe("");
    expect(last.carUnlocked).not.toBe("");
    expect(validateSave(loadSave(storage))).toBe(true);
  });
});

describe("coalesced writes", () => {
  function counting(storage: StorageAdapter): {
    adapter: StorageAdapter;
    writes: () => number;
  } {
    let count = 0;
    const adapter: StorageAdapter = {
      getItem: (key: string): string | null => storage.getItem(key),
      setItem: (key: string, value: string): void => {
        count += 1;
        storage.setItem(key, value);
      },
    };
    return { adapter, writes: () => count };
  }

  it("three rapid state writes schedule no disk write until flush()", async () => {
    const { adapter, writes } = counting(isolated());
    const state = new GameState(adapter);
    expect(writes()).toBe(0);
    state.selectCar("hatch");
    state.selectColor(2);
    state.selectEvent("neon_loop");
    expect(loadSave(adapter).progress.selected_car).toBe("");
    expect(writes()).toBe(0);
    state.flush();
    expect(writes()).toBe(1);
    const after = loadSave(adapter);
    expect(after.progress.selected_car).toBe("hatch");
    expect(after.progress.selected_color).toBe(2);
    expect(after.progress.current_event).toBe("neon_loop");
    state.flush();
    expect(writes()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(writes()).toBe(1);
    state.dispose();
  });

  it("an unflushed state write coalesces into one deferred write", async () => {
    const { adapter, writes } = counting(isolated());
    const state = new GameState(adapter);
    state.selectCar("hatch");
    state.selectCar("coupe");
    state.selectEvent("neon_loop");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(writes()).toBe(1);
    expect(loadSave(adapter).progress.selected_car).toBe("coupe");
    state.dispose();
  });

  it("three rapid settings writes schedule no disk write until flush()", async () => {
    const { adapter, writes } = counting(isolated());
    const store = new SettingsStore(adapter);
    expect(writes()).toBe(0);
    store.masterVolume = 0.3;
    store.assists = false;
    store.cameraShake = false;
    expect(writes()).toBe(0);
    store.flush();
    expect(writes()).toBe(1);
    const after = loadSave(adapter);
    expect(after.settings.master_volume).toBeCloseTo(0.3, 5);
    expect(after.settings.assists).toBe(false);
    expect(after.settings.camera_shake).toBe(false);
    store.flush();
    expect(writes()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(writes()).toBe(1);
    store.dispose();
  });
});

describe("settings defaults", () => {
  it("starts from the PRD section 10 values", () => {
    const store = new SettingsStore(isolated());
    expect(store.snapshot()).toEqual({
      masterVolume: 0.8,
      musicVolume: 0.7,
      sfxVolume: 0.9,
      assists: true,
      cameraShake: true,
    });
    store.dispose();
  });

  it("clamps numerics and falls back on garbage", () => {
    const store = new SettingsStore(isolated());
    store.masterVolume = 2;
    expect(store.masterVolume).toBe(1);
    store.musicVolume = -1;
    expect(store.musicVolume).toBe(0);
    store.sfxVolume = "loud" as unknown as number;
    expect(store.sfxVolume).toBe(0.9);
    store.assists = 1 as unknown as boolean;
    expect(store.assists).toBe(true);
    store.cameraShake = false;
    expect(store.cameraShake).toBe(false);
    store.dispose();
  });

  it("reload clamps out-of-range volumes and drops unknown keys", () => {
    const storage = isolated();
    seedRaw(storage, {
      version: 1,
      settings: {
        master_volume: 2,
        music_volume: 0.4,
        sfx_volume: 0.5,
        assists: false,
        camera_shake: false,
        aimbot: true,
      },
      progress: defaultSave().progress,
      records: {},
    });
    const store = new SettingsStore(storage);
    expect(store.masterVolume).toBe(1);
    expect(store.musicVolume).toBeCloseTo(0.4, 5);
    expect(store.assists).toBe(false);
    store.flush();
    const after = loadSave(storage);
    expect(after.settings).not.toHaveProperty("aimbot");
    store.dispose();
  });

  it("a fresh instance observes settings saved by another", () => {
    const storage = isolated();
    const first = new SettingsStore(storage);
    first.masterVolume = 0.3;
    first.musicVolume = 0.4;
    first.sfxVolume = 0.5;
    first.assists = false;
    first.cameraShake = false;
    first.flush();
    const second = new SettingsStore(storage);
    expect(second.masterVolume).toBeCloseTo(0.3, 5);
    expect(second.musicVolume).toBeCloseTo(0.4, 5);
    expect(second.sfxVolume).toBeCloseTo(0.5, 5);
    expect(second.assists).toBe(false);
    expect(second.cameraShake).toBe(false);
    first.dispose();
    second.dispose();
  });
});

describe("state selection", () => {
  it("select plus flush round-trips through loadSave", () => {
    const storage = isolated();
    const state = new GameState(storage);
    state.selectCar("hatch");
    state.selectEvent("neon_loop");
    state.flush();
    const loaded = loadSave(storage);
    expect(validateSave(loaded)).toBe(true);
    expect(loaded.progress.selected_car).toBe("hatch");
    expect(loaded.progress.current_event).toBe("neon_loop");
    const fresh = new GameState(storage);
    expect(fresh.getSelectedCar()).toBe("hatch");
    expect(fresh.getCurrentEvent()).toBe("neon_loop");
    expect(fresh.getSelectedColor()).toBe(0);
    state.dispose();
    fresh.dispose();
  });

  it("rejects non-numeric colors and non-string selections", () => {
    const storage = isolated();
    seedRaw(storage, {
      version: 1,
      settings: defaultSave().settings,
      progress: {
        unlocked_events: [],
        unlocked_cars: [],
        selected_car: 42,
        selected_color: "red",
        current_event: { route: "neon_loop" },
      },
      records: {},
    });
    const state = new GameState(storage);
    expect(state.getSelectedCar()).toBe("");
    expect(state.getSelectedColor()).toBe(0);
    expect(state.getCurrentEvent()).toBe("");
    state.dispose();
  });

  it("keeps the run mode and last result memory-only", () => {
    const storage = isolated();
    const state = new GameState(storage);
    state.selectCar("hatch");
    state.selectMode("time_trial");
    state.setLastResult({ place: 1 });
    expect(state.isTimeTrialMode()).toBe(true);
    expect(state.getLastResult()).toEqual({ place: 1 });
    state.selectMode("bogus");
    expect(state.currentMode).toBe("time_trial");
    state.flush();
    const raw = storedJson(storage);
    expect(raw).not.toContain("current_mode");
    expect(raw).not.toContain("last_result");
    const fresh = new GameState(storage);
    expect(fresh.currentMode).toBe("race");
    expect(fresh.getLastResult()).toEqual({});
    expect(fresh.getSelectedCar()).toBe("hatch");
    state.clearLastResult();
    expect(state.getLastResult()).toEqual({});
    state.dispose();
    fresh.dispose();
  });

  it("applyResult delegates to the ladder and refreshes the caches", () => {
    const storage = isolated();
    const state = new GameState(storage);
    const result = state.applyResult("neon_loop", 1);
    expect(result.unlockedCars).toContain("awd");
    expect(state.unlockedEvents).toContain("neon_loop");
    expect(state.unlockedCars).toContain("awd");
    state.dispose();
  });
});
