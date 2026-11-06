// Time-trial solo delta + judged-drift records acceptance suite
// (issue #224 contract). Isolated-storage idiom (save.test.ts) for the
// records owner plus the stub-DOM idiom (core.test.ts/screens.test.ts)
// for the results-screen writer: TT faster-only persistence with the
// 93.24 round-trip, delta formatting, drift higher-only integer storage,
// solo 1-racer arming, and the single-writer static scan. Mutating
// shared-storage tests heal via resetAll.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryStorage,
  defaultSave,
  loadSave,
  saveNow,
  validateSave,
  type StorageAdapter,
} from "../src/game/save";
import {
  allBests,
  all_bests,
  driftApi,
  getBest,
  get_best,
  getDriftBest,
  get_drift_best,
  saveBestIfFaster,
  save_best_if_faster,
  saveBestIfHigher,
  save_best_if_higher,
  timetrialApi,
} from "../src/game/records";
import { gameState } from "../src/game/state";
import { RaceManager } from "../src/race/manager";
import { formatDelta } from "../src/race/timetrial";
import { allBestsFromTable, bestFromTable as timeTrialBestFromTable } from "../src/race/timetrial";
import { bestFromTable as driftBestFromTable } from "../src/race/drift";
import { renderResults } from "../src/ui/results";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

function isolated(): StorageAdapter {
  return createMemoryStorage();
}

// Heal every shared singleton so suites start from defaults.
function resetAll(): void {
  saveNow(defaultSave());
  gameState.reloadFromDisk();
  gameState.clearLastResult();
  gameState.selectMode("race");
}

beforeEach(() => {
  resetAll();
});

afterEach(() => {
  resetAll();
});

describe("time-trial best persistence", () => {
  it("round-trips the 93.24 harbor_sprint record through loadSave", () => {
    const storage = isolated();
    expect(saveBestIfFaster("harbor_sprint", 95.0, 1, storage)).toBe(true);
    expect(saveBestIfFaster("harbor_sprint", 93.24, 1, storage)).toBe(true);
    const loaded = loadSave(storage);
    expect(validateSave(loaded)).toBe(true);
    expect(loaded.records.harbor_sprint.best_time_s).toBe(93.24);
    expect(loaded.records.harbor_sprint.best_position).toBe(1);
    expect(getBest("harbor_sprint", storage)).toBe(93.24);
  });

  it("rejects slower, equal, zero, negative, and empty writes", () => {
    const storage = isolated();
    expect(saveBestIfFaster("harbor_sprint", 95.0, 1, storage)).toBe(true);
    expect(saveBestIfFaster("harbor_sprint", 97.0, 1, storage)).toBe(false);
    expect(saveBestIfFaster("harbor_sprint", 95.0, 1, storage)).toBe(false);
    expect(saveBestIfFaster("harbor_sprint", 0, 1, storage)).toBe(false);
    expect(saveBestIfFaster("harbor_sprint", -3.2, 1, storage)).toBe(false);
    expect(saveBestIfFaster("", 90.0, 1, storage)).toBe(false);
    expect(saveBestIfFaster("harbor_sprint", Number.NaN, 1, storage)).toBe(false);
    expect(getBest("harbor_sprint", storage)).toBe(95.0);
    expect(getBest("downtown_gp", storage)).toBe(-1);
    expect(getBest("", storage)).toBe(-1);
    expect(validateSave(loadSave(storage))).toBe(true);
  });

  it("merges sibling keys and snapshots every positive best", () => {
    const storage = isolated();
    expect(saveBestIfFaster("drift_park", 100.0, 1, storage)).toBe(true);
    expect(saveBestIfHigher("drift_park", 500, storage)).toBe(true);
    const loaded = loadSave(storage);
    expect(loaded.records.drift_park.best_time_s).toBe(100.0);
    expect(loaded.records.drift_park.best_drift_score).toBe(500);
    expect(validateSave(loaded)).toBe(true);
    expect(allBests(storage)).toEqual({
      drift_park: 100.0,
    });
    expect(all_bests(storage)).toEqual(allBests(storage));
  });
});

describe("judged-drift best persistence", () => {
  it("stores 1500 as the integer best and truncates fractions", () => {
    const storage = isolated();
    expect(saveBestIfHigher("drift_park", 1500, storage)).toBe(true);
    expect(getDriftBest("drift_park", storage)).toBe(1500);
    expect(loadSave(storage).records.drift_park.best_drift_score).toBe(1500);
    expect(saveBestIfHigher("drift_park", 1200, storage)).toBe(false);
    expect(saveBestIfHigher("drift_park", 1500.9, storage)).toBe(false);
    expect(saveBestIfHigher("drift_park", 1600.9, storage)).toBe(true);
    expect(getDriftBest("drift_park", storage)).toBe(1600);
    expect(loadSave(storage).records.drift_park.best_drift_score).toBe(1600);
    expect(validateSave(loadSave(storage))).toBe(true);
  });

  it("rejects zero, negative, empty, and non-numeric writes", () => {
    const storage = isolated();
    expect(saveBestIfHigher("drift_park", 0, storage)).toBe(false);
    expect(saveBestIfHigher("drift_park", -40, storage)).toBe(false);
    expect(saveBestIfHigher("", 1500, storage)).toBe(false);
    expect(saveBestIfHigher("drift_park", Number.NaN, storage)).toBe(false);
    expect(getDriftBest("drift_park", storage)).toBe(0);
    expect(getDriftBest("", storage)).toBe(0);
    expect(Object.keys(loadSave(storage).records)).toEqual([]);
  });
});

describe("disk-free table reads", () => {
  it("reads time bests without storage access", () => {
    const table = { harbor_sprint: { best_time_s: 93.24, best_position: 1 } };
    expect(timeTrialBestFromTable(table, "harbor_sprint")).toBe(93.24);
    expect(timeTrialBestFromTable(table, "downtown_gp")).toBe(-1);
    expect(timeTrialBestFromTable(null, "harbor_sprint")).toBe(-1);
    expect(
      timeTrialBestFromTable({ harbor_sprint: { best_time_s: 0 } }, "harbor_sprint"),
    ).toBe(-1);
    expect(allBestsFromTable(table)).toEqual({ harbor_sprint: 93.24 });
    expect(allBestsFromTable(null)).toEqual({});
  });

  it("reads drift bests truncated without storage access", () => {
    expect(
      driftBestFromTable({ drift_park: { best_drift_score: 1500 } }, "drift_park"),
    ).toBe(1500);
    expect(
      driftBestFromTable({ drift_park: { best_drift_score: 1500.9 } }, "drift_park"),
    ).toBe(1500);
    expect(driftBestFromTable({}, "drift_park")).toBe(0);
    expect(driftBestFromTable(null, "drift_park")).toBe(0);
  });

  it("keeps the v1 snake_case aliases on the same reference", () => {
    expect(get_best).toBe(getBest);
    expect(save_best_if_faster).toBe(saveBestIfFaster);
    expect(get_drift_best).toBe(getDriftBest);
    expect(save_best_if_higher).toBe(saveBestIfHigher);
    expect(timetrialApi.saveBestIfFaster).toBe(saveBestIfFaster);
    expect(driftApi.saveBestIfHigher).toBe(saveBestIfHigher);
  });
});

describe("time-trial HUD delta", () => {
  it("formats a +2s deficit with sign and seconds", () => {
    const delta = formatDelta(2.0);
    expect(delta.startsWith("+")).toBe(true);
    expect(delta).toContain("2.");
    expect(formatDelta(97.0 - 95.0)).toBe("+00:02.000");
  });

  it("arms a solo 1-racer field in time-trial mode", () => {
    const solo = new RaceManager();
    solo.startEvent("harbor_sprint", 1);
    expect(solo.racers).toHaveLength(1);
    expect(solo.racers[0]).toBe("player");
    expect(solo.best).toBeNull();
    expect(solo.driftTotal).toBe(0);
  });
});

describe("single-writer scan", () => {
  it("keeps bests writes in the results screen, never the race path", () => {
    const managerText = readFileSync(join(srcDir, "race", "manager.ts"), "utf8");
    const mainText = readFileSync(join(srcDir, "main.ts"), "utf8");
    const resultsText = readFileSync(join(srcDir, "ui", "results.ts"), "utf8");
    for (const name of ["saveBestIfFaster", "saveBestIfHigher"]) {
      expect(managerText).not.toMatch(new RegExp(name));
      expect(mainText).not.toMatch(new RegExp(name));
      expect(resultsText).toMatch(new RegExp(name));
    }
  });

  it("keeps the race table modules import-free", () => {
    for (const file of ["timetrial.ts", "drift.ts"]) {
      const text = readFileSync(join(srcDir, "race", file), "utf8");
      expect(text).not.toMatch(/^\s*import\s/m);
    }
  });
});

type StubNode = {
  tagName: string;
  id: string;
  textContent: string | null;
  disabled: boolean;
  hidden: boolean;
  style: Record<string, string>;
  value: string;
  checked: boolean;
  type: string;
  children: StubNode[];
  appendChild: (child: StubNode) => StubNode;
  replaceChildren: (...nodes: StubNode[]) => void;
  addEventListener: (type: string, listener: (e?: unknown) => void) => void;
  click: () => void;
  dispatchEvent: (event: { type: string }) => boolean;
};

function makeNode(tag: string): StubNode {
  const listeners = new Map<string, Array<(e?: unknown) => void>>();
  const node: StubNode = {
    tagName: tag.toUpperCase(),
    id: "",
    textContent: "",
    disabled: false,
    hidden: false,
    style: {},
    value: "",
    checked: false,
    type: "",
    children: [],
    appendChild: (child: StubNode): StubNode => {
      node.children.push(child);
      return child;
    },
    replaceChildren: (...nodes: StubNode[]): void => {
      node.children.length = 0;
      for (const next of nodes) {
        node.children.push(next);
      }
    },
    addEventListener: (type: string, listener: (e?: unknown) => void): void => {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    click: (): void => {
      for (const listener of [...(listeners.get("click") ?? [])]) {
        listener({ type: "click", target: node });
      }
    },
    dispatchEvent: (event: { type: string }): boolean => {
      for (const listener of [...(listeners.get(event.type) ?? [])]) {
        listener({ type: event.type, target: node });
      }
      return true;
    },
  };
  return node;
}

type StubDoc = {
  body: StubNode;
  createElement: (tag: string) => StubNode;
  getElementById: (id: string) => StubNode | null;
};

function makeDoc(): StubDoc {
  const doc: StubDoc = {
    body: makeNode("body"),
    createElement: (tag: string): StubNode => makeNode(tag),
    getElementById: (): StubNode | null => null,
  };
  return doc;
}

function findById(root: StubNode, id: string): StubNode | null {
  if (root.id === id) {
    return root;
  }
  for (const child of root.children) {
    const hit = findById(child, id);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

let doc: StubDoc;

beforeAll(() => {
  doc = makeDoc();
  (globalThis as unknown as { document?: unknown }).document = doc;
});

afterAll(() => {
  try {
    delete (globalThis as unknown as { document?: unknown }).document;
  } catch {
    // Best effort.
  }
  resetAll();
});

describe("results judged-run writer", () => {
  function driftHandoff(): Record<string, unknown> {
    return {
      event_id: "drift_park",
      player_racer: "player",
      places: [{ racer: "player", time_s: 120.5, place: 1 }],
      drift_score: 1500,
    };
  }

  it("stores the 1500 drift score as an integer plus the DRIFT line", () => {
    gameState.setLastResult(driftHandoff());
    const stub = doc.createElement("div");
    renderResults(stub as unknown as HTMLElement, null);
    const stored = loadSave().records.drift_park;
    expect(stored.best_drift_score).toBe(1500);
    expect(Number.isInteger(stored.best_drift_score)).toBe(true);
    expect(validateSave(loadSave())).toBe(true);
    const driftLine = findById(stub, "DriftLine");
    expect(driftLine).not.toBeNull();
    expect(driftLine?.textContent ?? "").toContain("1500");
    const best = findById(stub, "BestBanner");
    expect(best?.hidden).toBe(false);
  });

  it("stores the 93.24 time-trial finish through the results screen", () => {
    gameState.setLastResult({
      event_id: "harbor_sprint",
      player_racer: "player",
      places: [{ racer: "player", time_s: 93.24, place: 1 }],
    });
    const stub = doc.createElement("div");
    renderResults(stub as unknown as HTMLElement, null);
    expect(loadSave().records.harbor_sprint.best_time_s).toBe(93.24);
    expect(loadSave().records.harbor_sprint.best_position).toBe(1);
    const rows = findById(stub, "ResultsList");
    expect(rows?.children.length).toBe(1);
    expect(rows?.children[0]?.textContent ?? "").toContain("▶");
  });
});
