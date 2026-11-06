// Shell-screens acceptance suite (issue #220 contract): stub-DOM tests
// with no browser, no WebGL, no WASM. Covers the three acceptance
// predicates (menu buttons, settings master 0.5 persist round-trip,
// results retry/next) plus lock/mode/persist behavior, pause wiring, and
// the garage lock rule. Mutating shared-storage tests heal via resetAll.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { Router } from "../src/core/router";
import { gameState } from "../src/game/state";
import { settings } from "../src/game/settings";
import { defaultSave, loadSave, saveNow } from "../src/game/save";
import { manager } from "../src/race/manager";
import { renderMenu } from "../src/ui/menu";
import { renderEventSelect } from "../src/ui/eventSelect";
import { renderGarage } from "../src/ui/garage";
import { renderSettings } from "../src/ui/settings";
import { attachPause } from "../src/ui/pause";
import { renderResults } from "../src/ui/results";

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

function textOf(node: StubNode | null): string {
  return node?.textContent ?? "";
}

function makeContainer(doc: StubDoc): {
  element: HTMLElement;
  stub: StubNode;
} {
  const stub = doc.createElement("div");
  return { element: stub as unknown as HTMLElement, stub };
}

function makeRouter(container: HTMLElement): Router {
  const router = new Router(container);
  router.register("menu", (c) => renderMenu(c, router));
  router.register("event-select", (c) => renderEventSelect(c, router));
  router.register("garage", (c) => renderGarage(c, router));
  router.register("settings", (c) => renderSettings(c, router));
  router.register("results", (c) => renderResults(c, router));
  router.register("race", () => {});
  return router;
}

// Heal every shared singleton so suites start from defaults.
function resetAll(): void {
  saveNow(defaultSave());
  gameState.reloadFromDisk();
  settings.reloadFromDisk();
  gameState.clearLastResult();
  gameState.selectMode("race");
  try {
    manager.resetRace();
  } catch {
    // Unarmed manager resets are no-ops.
  }
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

describe("menu screen", () => {
  it("shows #screen-menu with race, garage, and settings buttons", () => {
    const { element, stub } = makeContainer(doc);
    const router = makeRouter(element);
    router.show("menu");
    expect(router.current()).toBe("menu");
    expect(findById(stub, "screen-menu")).not.toBeNull();
    expect(findById(stub, "btn-race")).not.toBeNull();
    expect(findById(stub, "btn-garage")).not.toBeNull();
    expect(findById(stub, "btn-settings")).not.toBeNull();
  });

  it("routes Race to event select, Garage to garage, Settings to settings", () => {
    const { element, stub } = makeContainer(doc);
    const router = makeRouter(element);
    router.show("menu");
    findById(stub, "btn-race")?.click();
    expect(router.current()).toBe("event-select");
    expect(findById(stub, "screen-event-select")).not.toBeNull();
    router.show("menu");
    findById(stub, "btn-garage")?.click();
    expect(router.current()).toBe("garage");
    expect(findById(stub, "screen-garage")).not.toBeNull();
    router.show("menu");
    findById(stub, "btn-settings")?.click();
    expect(router.current()).toBe("settings");
    expect(findById(stub, "screen-settings")).not.toBeNull();
  });

  it("never throws with a null router", () => {
    const { element } = makeContainer(doc);
    expect(() => renderMenu(element, null)).not.toThrow();
  });
});

describe("event select screen", () => {
  it("leaves harbor open while downtown boots locked", () => {
    const { element, stub } = makeContainer(doc);
    renderEventSelect(element, null);
    const harbor = findById(stub, "btn-event-harbor_sprint");
    const downtown = findById(stub, "btn-event-downtown_gp");
    expect(harbor).not.toBeNull();
    expect(harbor?.disabled).toBe(false);
    expect(textOf(harbor)).not.toContain("Locked");
    expect(downtown).not.toBeNull();
    expect(downtown?.disabled).toBe(true);
    expect(textOf(downtown)).toContain("🔒 Locked");
  });

  it("opens the next rung after a podium unlock", () => {
    gameState.applyResult("harbor_sprint", 1);
    const { element, stub } = makeContainer(doc);
    renderEventSelect(element, null);
    expect(findById(stub, "btn-event-downtown_gp")?.disabled).toBe(false);
  });

  it("toggles the run mode label Race and Time Trial", () => {
    const { element, stub } = makeContainer(doc);
    renderEventSelect(element, null);
    const mode = findById(stub, "btn-mode");
    expect(textOf(mode)).toBe("Mode: Race");
    mode?.click();
    expect(textOf(findById(stub, "btn-mode"))).toBe("Mode: Time Trial");
    expect(gameState.isTimeTrialMode()).toBe(true);
    findById(stub, "btn-mode")?.click();
    expect(textOf(findById(stub, "btn-mode"))).toBe("Mode: Race");
    expect(gameState.isTimeTrialMode()).toBe(false);
  });

  it("selects the event and routes to the garage on pick", () => {
    const { element, stub } = makeContainer(doc);
    const router = makeRouter(element);
    router.show("event-select");
    findById(stub, "btn-event-harbor_sprint")?.click();
    expect(gameState.getCurrentEvent()).toBe("harbor_sprint");
    expect(router.current()).toBe("garage");
  });
});

describe("garage screen", () => {
  it("leaves the sedan open while the coupe boots locked", () => {
    const { element, stub } = makeContainer(doc);
    renderGarage(element, null);
    const sedan = findById(stub, "btn-car-sedan");
    const coupe = findById(stub, "btn-car-coupe");
    expect(sedan?.disabled).toBe(false);
    expect(textOf(sedan)).not.toContain("Locked");
    expect(coupe?.disabled).toBe(true);
    expect(textOf(coupe)).toContain("🔒 Locked");
  });

  it("persists car and color picks through the game state", () => {
    const { element, stub } = makeContainer(doc);
    renderGarage(element, null);
    findById(stub, "btn-car-sedan")?.click();
    expect(gameState.getSelectedCar()).toBe("sedan");
    findById(stub, "btn-color-2")?.click();
    expect(gameState.getSelectedColor()).toBe(2);
  });

  it("arms the manager and routes to the race on start", () => {
    const { element, stub } = makeContainer(doc);
    const router = makeRouter(element);
    router.show("garage");
    findById(stub, "btn-start")?.click();
    expect(manager.eventId).toBe("harbor_sprint");
    expect(router.current()).toBe("race");
  });
});

describe("settings screen", () => {
  it("seeds sliders and toggles from the snapshot", () => {
    const { element, stub } = makeContainer(doc);
    renderSettings(element, null);
    expect(findById(stub, "vol-master")).not.toBeNull();
    expect(findById(stub, "vol-music")).not.toBeNull();
    expect(findById(stub, "vol-sfx")).not.toBeNull();
    expect(findById(stub, "tgl-assists")).not.toBeNull();
    expect(findById(stub, "tgl-shake")).not.toBeNull();
    expect(findById(stub, "vol-master")?.value).toBe("0.8");
    expect(findById(stub, "tgl-assists")?.checked).toBe(true);
  });

  it("persists master 0.5 across a reload round-trip", () => {
    const { element, stub } = makeContainer(doc);
    renderSettings(element, null);
    const master = findById(stub, "vol-master");
    expect(master).not.toBeNull();
    if (master !== null) {
      master.value = "0.5";
      master.dispatchEvent({ type: "change" });
    }
    expect(loadSave().settings.master_volume).toBe(0.5);
    settings.reloadFromDisk();
    expect(settings.masterVolume).toBe(0.5);
  });

  it("returns to the menu on back", () => {
    const { element, stub } = makeContainer(doc);
    const router = makeRouter(element);
    router.show("settings");
    findById(stub, "btn-back")?.click();
    expect(router.current()).toBe("menu");
  });
});

describe("results screen", () => {
  function winHandoff(): Record<string, unknown> {
    return {
      event_id: "harbor_sprint",
      player_racer: "player",
      places: [
        { racer: "player", time_s: 80.0, place: 1 },
        { racer: "ai_1", time_s: 85.2, place: 2 },
        { racer: "ai_2", time_s: 87.1, place: 3 },
        { racer: "ai_3", time_s: 91.0, place: 4 },
        { racer: "ai_4", time_s: 95.5, place: 5 },
      ],
    };
  }

  it("shows retry and next from a fresh-win handoff with banners", () => {
    gameState.setLastResult(winHandoff());
    const { element, stub } = makeContainer(doc);
    const router = makeRouter(element);
    router.show("results");
    expect(findById(stub, "screen-results")).not.toBeNull();
    expect(findById(stub, "btn-retry")).not.toBeNull();
    expect(findById(stub, "btn-next")).not.toBeNull();
    expect(findById(stub, "btn-menu")).not.toBeNull();
    expect(findById(stub, "results-list")?.children.length).toBe(5);
    const unlock = findById(stub, "banner-unlock");
    const best = findById(stub, "banner-best");
    expect(unlock?.hidden).toBe(false);
    expect(textOf(unlock)).toContain("NEW UNLOCK");
    expect(best?.hidden).toBe(false);
    expect(textOf(best)).toContain("NEW BEST");
  });

  it("hides both banners when nothing fresh is earned", () => {
    gameState.setLastResult(winHandoff());
    const first = makeContainer(doc);
    renderResults(first.element, null);
    const second = makeContainer(doc);
    renderResults(second.element, null);
    expect(findById(second.stub, "banner-unlock")?.hidden).toBe(true);
    expect(findById(second.stub, "banner-best")?.hidden).toBe(true);
    expect(findById(second.stub, "btn-retry")).not.toBeNull();
    expect(findById(second.stub, "btn-next")).not.toBeNull();
  });

  it("falls back to the five-row mock when the handoff is missing", () => {
    gameState.clearLastResult();
    const { element, stub } = makeContainer(doc);
    renderResults(element, null);
    expect(findById(stub, "screen-results")).not.toBeNull();
    expect(findById(stub, "results-list")?.children.length).toBe(5);
    expect(findById(stub, "btn-retry")).not.toBeNull();
    expect(findById(stub, "btn-next")).not.toBeNull();
  });

  it("retries the same event and advances the ladder on next", () => {
    gameState.setLastResult(winHandoff());
    const { element, stub } = makeContainer(doc);
    const router = makeRouter(element);
    router.show("results");
    findById(stub, "btn-retry")?.click();
    expect(manager.eventId).toBe("harbor_sprint");
    expect(router.current()).toBe("race");
    router.show("results");
    findById(stub, "btn-next")?.click();
    expect(gameState.getCurrentEvent()).toBe("downtown_gp");
    expect(router.current()).toBe("event-select");
  });
});

describe("pause overlay", () => {
  it("mounts hidden and toggles through the handle", () => {
    const { element } = makeContainer(doc);
    const router = makeRouter(element);
    const pause = attachPause(element, router);
    expect(pause.element).not.toBeNull();
    const overlay = pause.element as unknown as StubNode;
    expect(overlay.hidden).toBe(true);
    pause.setVisible(true);
    expect(overlay.hidden).toBe(false);
    pause.setVisible(false);
    expect(overlay.hidden).toBe(true);
  });

  it("wires resume, restart, and quit", () => {
    const { element } = makeContainer(doc);
    const router = makeRouter(element);
    const pause = attachPause(element, router);
    const overlay = pause.element as unknown as StubNode;
    pause.setVisible(true);
    findById(overlay, "btn-resume")?.click();
    expect(overlay.hidden).toBe(true);
    pause.setVisible(true);
    expect(() => findById(overlay, "btn-restart")?.click()).not.toThrow();
    expect(overlay.hidden).toBe(true);
    pause.setVisible(true);
    findById(overlay, "btn-quit")?.click();
    expect(overlay.hidden).toBe(true);
    expect(router.current()).toBe("menu");
  });
});

describe("screens hygiene", () => {
  it("carries no three.js or rapier imports", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of [
      "screens.ts",
      "menu.ts",
      "eventSelect.ts",
      "garage.ts",
      "settings.ts",
      "pause.ts",
      "results.ts",
    ]) {
      const text = readFileSync(join(here, "..", "src", "ui", file), "utf8");
      expect(text).not.toMatch(/three/);
      expect(text).not.toMatch(/rapier/i);
      expect(text).not.toMatch(/@dimforge/);
    }
  });
});
