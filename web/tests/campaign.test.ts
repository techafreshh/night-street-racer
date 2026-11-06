// Campaign acceptance suite (issue #229 contract): the six-event ladder
// end-to-end wiring with isolated storage plus stub DOM (no browser,
// no WebGL, no WASM). Covers the acceptance predicates with no padding:
// top-3 harbor opens downtown and a downtown win grants the mapped car
// with both surviving a fresh reload, a TT saveBestIfFaster write
// re-rendering on event select with the BEST tag matching the results
// banner, the race-scoped Escape guard, fps EMA convergence, and
// car-anchored FX emission. Mutating shared-storage tests heal via
// resetAll (screens.test.ts idiom).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFpsMeter } from "../src/core/loop";
import { Router } from "../src/core/router";
import {
  LADDER,
  applyResult,
  isEventUnlocked,
  mappedCar,
  nextEventAfter,
  unlockedEvents,
} from "../src/game/progression";
import {
  allBests,
  getBest,
  saveBestIfFaster,
} from "../src/game/records";
import {
  createMemoryStorage,
  defaultSave,
  loadSave,
  saveNow,
  type StorageAdapter,
} from "../src/game/save";
import { GameState, gameState } from "../src/game/state";
import { formatTime } from "../src/race/timetrial";
import { renderEventSelect } from "../src/ui/eventSelect";
import { renderResults } from "../src/ui/results";
import { attachPause } from "../src/ui/pause";
import {
  SLIP_THRESHOLD,
  SPEED_GATE,
  SMOKE_MAX,
  VehicleFX,
} from "../src/vehicles/fx";
import {
  buildSkidMesh,
  buildSmokeBillboards,
  syncSkids,
  syncSmoke,
} from "../src/render/effects";

const DT = 1 / 60;

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
  parentElement: null;
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
    parentElement: null,
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

function makeContainer(doc: StubDoc): { element: HTMLElement; stub: StubNode } {
  const stub = doc.createElement("div");
  return { element: stub as unknown as HTMLElement, stub };
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

beforeEach(() => {
  resetAll();
});

afterEach(() => {
  resetAll();
});

describe("unlock chain plus reload", () => {
  it("top-3 harbor opens downtown and the ladder spans six events", () => {
    expect(LADDER).toHaveLength(6);
    const storage = isolated();
    // Given a fresh profile, when placing top 3 on harbor_sprint.
    const podium = applyResult("harbor_sprint", 3, storage);
    // Then the next rung opens with no car granted.
    expect(podium.eventUnlocked).toBe("downtown_gp");
    expect(nextEventAfter("harbor_sprint")).toBe("downtown_gp");
    expect(podium.carUnlocked).toBe("");
    expect(unlockedEvents(storage)).toContain("harbor_sprint");
    expect(isEventUnlocked("harbor_sprint", unlockedEvents(storage))).toBe(true);
    expect(isEventUnlocked("downtown_gp", unlockedEvents(storage))).toBe(true);
    expect(isEventUnlocked("neon_loop", unlockedEvents(storage))).toBe(false);
  });

  it("a downtown win grants the mapped car and both survive a fresh reload", () => {
    const storage = isolated();
    // Given the harbor podium, when winning downtown_gp.
    applyResult("harbor_sprint", 3, storage);
    const win = applyResult("downtown_gp", 1, storage);
    // Then the mapped car is earned and the next rung opens.
    expect(mappedCar("downtown_gp")).toBe("hatch");
    expect(win.carUnlocked).toBe("hatch");
    expect(win.unlockedCars).toContain("hatch");
    expect(win.eventUnlocked).toBe("neon_loop");
    // And both survive a fresh loadSave plus GameState reload.
    const reloaded = loadSave(storage);
    expect(reloaded.progress.unlocked_events).toContain("harbor_sprint");
    expect(reloaded.progress.unlocked_events).toContain("downtown_gp");
    expect(reloaded.progress.unlocked_cars).toContain("hatch");
    const fresh = new GameState(storage);
    try {
      expect(fresh.unlockedEvents).toContain("harbor_sprint");
      expect(fresh.unlockedEvents).toContain("downtown_gp");
      expect(fresh.unlockedCars).toContain("hatch");
      expect(isEventUnlocked("downtown_gp", fresh.unlockedEvents)).toBe(true);
      expect(isEventUnlocked("neon_loop", fresh.unlockedEvents)).toBe(true);
    } finally {
      fresh.dispose();
    }
  });
});

describe("time-trial best select match", () => {
  it("re-renders the BEST tag matching the results banner across a reload", () => {
    // Given a harbor time-trial win recorded through the results writer.
    gameState.setLastResult({
      event_id: "harbor_sprint",
      player_racer: "player",
      places: [{ racer: "player", time_s: 93.24, place: 1 }],
    });
    const first = makeContainer(doc);
    renderResults(first.element, null);
    // Then the results banner names the new best.
    const banner = findById(first.stub, "BestBanner");
    expect(banner?.hidden).toBe(false);
    expect(banner?.textContent ?? "").toContain(formatTime(93.24));
    expect(getBest("harbor_sprint")).toBe(93.24);
    expect(allBests().harbor_sprint).toBe(93.24);
    // And the event-select grid tags the same best.
    const grid = makeContainer(doc);
    renderEventSelect(grid.element, null);
    const button = findById(grid.stub, "Event_harbor_sprint");
    expect(button?.textContent ?? "").toContain("BEST");
    expect(button?.textContent ?? "").toContain(formatTime(93.24));
    // And the tag survives a reload round-trip.
    gameState.reloadFromDisk();
    expect(saveBestIfFaster("harbor_sprint", 93.24, 1)).toBe(false);
    expect(getBest("harbor_sprint")).toBe(93.24);
    const again = makeContainer(doc);
    renderEventSelect(again.element, null);
    expect(findById(again.stub, "Event_harbor_sprint")?.textContent ?? "").toContain(
      formatTime(93.24),
    );
  });
});

describe("pause hotkey scope", () => {
  it("toggles on race only and stays hidden on every other screen", () => {
    // Capture the keydown wiring attachPause registers on globalThis.
    const captured = new Map<string, Array<(e?: unknown) => void>>();
    const prior = (globalThis as unknown as { addEventListener?: unknown }).addEventListener;
    (globalThis as unknown as { addEventListener: unknown }).addEventListener = (
      type: string,
      listener: (e?: unknown) => void,
    ): void => {
      const list = captured.get(type) ?? [];
      list.push(listener);
      captured.set(type, list);
    };
    try {
      const { element } = makeContainer(doc);
      const router = new Router(element);
      for (const name of ["menu", "event-select", "garage", "settings", "results", "race"]) {
        router.register(name, () => {});
      }
      const pause = attachPause(element, router);
      const fireEscape = (): void => {
        for (const listener of [...(captured.get("keydown") ?? [])]) {
          listener({ key: "Escape" });
        }
      };
      // Given each non-race screen, Escape never surfaces the overlay.
      for (const name of ["menu", "event-select", "garage", "settings", "results"]) {
        pause.setVisible(false);
        router.show(name);
        fireEscape();
        expect(pause.isVisible()).toBe(false);
        expect((pause.element as unknown as StubNode | null)?.hidden).toBe(true);
      }
      // When racing, Escape toggles the overlay on and off.
      pause.setVisible(false);
      router.show("race");
      fireEscape();
      expect(pause.isVisible()).toBe(true);
      fireEscape();
      expect(pause.isVisible()).toBe(false);
    } finally {
      if (prior === undefined) {
        try {
          delete (globalThis as unknown as { addEventListener?: unknown }).addEventListener;
        } catch {
          // Best effort.
        }
      } else {
        (globalThis as unknown as { addEventListener: unknown }).addEventListener = prior;
      }
    }
  });
});

describe("fps meter", () => {
  it("converges near 60 on synthetic 60 Hz timestamps", () => {
    const meter = createFpsMeter();
    let now = 1000;
    meter.sample(now);
    expect(meter.fps).toBe(0);
    for (let i = 0; i < 300; i += 1) {
      now += 1000 / 60;
      meter.sample(now);
    }
    expect(meter.fps).toBeGreaterThan(55);
    expect(meter.fps).toBeLessThan(65);
  });

  it("ignores non-finite stamps and background-tab gaps", () => {
    const meter = createFpsMeter();
    let now = 2000;
    meter.sample(now);
    for (let i = 0; i < 120; i += 1) {
      now += 1000 / 60;
      meter.sample(now);
    }
    const steady = meter.fps;
    expect(steady).toBeGreaterThan(55);
    meter.sample(Number.NaN);
    meter.sample(now + 60_000);
    expect(meter.fps).toBe(steady);
    meter.reset();
    expect(meter.fps).toBe(0);
  });
});

describe("fx car anchoring", () => {
  it("emits smoke at the car position and syncs non-zero scene instances", () => {
    const fx = new VehicleFX();
    const anchor = { x: 42, y: 1, z: -17 };
    // Given slip past the gate at speed, at the car anchor.
    expect(SLIP_THRESHOLD).toBe(0.25);
    expect(SPEED_GATE).toBe(5.0);
    for (let i = 0; i < 10; i += 1) {
      fx.update(DT, { slip: 0.3, speed: 20, pos: anchor });
    }
    expect(fx.smoke.activeCount).toBeGreaterThan(0);
    // Then live puffs track the car, never the origin.
    const out = { x: 0, y: 0, z: 0 };
    let tracked = 0;
    for (let i = 0; i < SMOKE_MAX; i += 1) {
      if (!fx.smoke.isAlive(i)) {
        continue;
      }
      fx.smoke.puffPosition(i, out);
      expect(out.x).toBeCloseTo(anchor.x, 5);
      expect(out.y).toBeCloseTo(anchor.y, 5);
      expect(out.z).toBeCloseTo(anchor.z, 5);
      tracked += 1;
    }
    expect(tracked).toBeGreaterThan(0);
    // And the skid rung straddles the car laterally.
    const rung = fx.skids.segment(0);
    expect(rung).not.toBeNull();
    expect(rung?.left.x ?? 0).toBeCloseTo(anchor.x - 0.8, 5);
    expect(rung?.right.x ?? 0).toBeCloseTo(anchor.x + 0.8, 5);
    // And the scene sync writes non-zero instances.
    const smokeMesh = buildSmokeBillboards();
    syncSmoke(smokeMesh, fx.smoke);
    const cells = smokeMesh.instanceMatrix.array as ArrayLike<number>;
    let nonZero = 0;
    for (let i = 0; i < cells.length; i += 1) {
      if (cells[i] !== 0) {
        nonZero += 1;
      }
    }
    expect(nonZero).toBeGreaterThan(0);
    const skidMesh = buildSkidMesh();
    syncSkids(skidMesh, fx.skids);
    expect(skidMesh.geometry.drawRange.count).toBeGreaterThan(0);
    smokeMesh.geometry.dispose();
    skidMesh.geometry.dispose();
  });
});
