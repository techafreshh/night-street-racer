// Save contract suite: schema constants, defaults, strict validation,
// and lenient-load clamping (save.test.ts isolated-memory idiom).
import { afterEach, describe, expect, it } from "vitest";
import {
  SAVE_KEY,
  SAVE_VERSION,
  SCHEMA_VERSION,
  createMemoryStorage,
  defaultSave,
  loadSave,
  saveNow,
  validateSave,
  type StorageAdapter,
} from "../../src/game/save";

function isolated(): StorageAdapter {
  return createMemoryStorage();
}

afterEach(() => {
  saveNow(defaultSave());
});

describe("save schema contract", () => {
  it("uses the nsr_save key with schema version 1", () => {
    expect(SAVE_KEY).toBe("nsr_save");
    expect(SAVE_VERSION).toBe(1);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("defaults validate and carry the PRD section 10 volumes", () => {
    const fresh = defaultSave();
    expect(validateSave(fresh)).toBe(true);
    expect(fresh.settings).toEqual({
      master_volume: 0.8,
      music_volume: 0.7,
      sfx_volume: 0.9,
      assists: true,
      camera_shake: true,
    });
    expect(fresh.progress.selected_car).toBe("");
    expect(fresh.records).toEqual({});
  });
});

describe("save strict validation contract", () => {
  it("rejects bad versions and volumes, accepts defaults", () => {
    for (const version of [2, 0, "1", 1.5, null]) {
      const doc = defaultSave() as unknown as Record<string, unknown>;
      doc.version = version;
      expect(validateSave(doc)).toBe(false);
    }
    const loud = defaultSave();
    loud.settings.master_volume = 2;
    expect(validateSave(loud)).toBe(false);
    const badList = defaultSave();
    (badList.progress as unknown as Record<string, unknown>).unlocked_events =
      "harbor_sprint";
    expect(validateSave(badList)).toBe(false);
  });

  it("round-trips unlocked events through isolated storage", () => {
    const storage = isolated();
    const doc = defaultSave();
    doc.progress.unlocked_events = ["harbor_sprint"];
    expect(saveNow(doc, storage)).toBe(true);
    const loaded = loadSave(storage);
    expect(loaded.version).toBe(1);
    expect(loaded.progress.unlocked_events).toEqual(["harbor_sprint"]);
    expect(validateSave(loaded)).toBe(true);
  });
});

describe("save lenient-load contract", () => {
  it("clamps master_volume 2 to 1 and drops unknown keys", () => {
    const storage = isolated();
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        settings: { master_volume: 2, bogus_key: 123 },
        progress: { unlocked_events: ["harbor_sprint"] },
        records: {},
      }),
    );
    const loaded = loadSave(storage);
    expect(loaded.settings.master_volume).toBe(1);
    expect(loaded.settings).not.toHaveProperty("bogus_key");
    expect(validateSave(loaded)).toBe(true);
  });

  it("falls back to defaults on missing or corrupt storage", () => {
    expect(loadSave(isolated())).toEqual(defaultSave());
    const storage = isolated();
    storage.setItem(SAVE_KEY, "{not valid json!!!");
    expect(loadSave(storage)).toEqual(defaultSave());
  });
});
