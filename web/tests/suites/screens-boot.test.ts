// Screens-boot contract suite (12th suite): every shell screen renders
// its shell through the stub-DOM idiom with no browser/WebGL/WASM,
// the settings master 0.5 edit persists, and results retry/next route.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Router } from "../../src/core/router";
import { gameState } from "../../src/game/state";
import { settings } from "../../src/game/settings";
import { defaultSave, loadSave, saveNow } from "../../src/game/save";
import { manager } from "../../src/race/manager";
import { renderMenu } from "../../src/ui/menu";
import { renderEventSelect } from "../../src/ui/eventSelect";
import { renderGarage } from "../../src/ui/garage";
import { renderSettings } from "../../src/ui/settings";
import { renderResults } from "../../src/ui/results";

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

describe("screens boot", () => {
  it("menu renders #screen-menu with race/garage/settings", () => {
    const { element, stub } = makeContainer(doc);
    const router = makeRouter(element);
    router.show("menu");
    expect(findById(stub, "screen-menu")).not.toBeNull();
    expect(findById(stub, "btn-race")).not.toBeNull();
    expect(findById(stub, "btn-garage")).not.toBeNull();
    expect(findById(stub, "btn-settings")).not.toBeNull();
  });

  it("garage leaves the sedan open while the coupe boots locked", () => {
    const { element, stub } = makeContainer(doc);
    renderGarage(element, null);
    expect(findById(stub, "btn-select-sedan")?.disabled).toBe(false);
    expect(findById(stub, "btn-select-coupe")?.disabled).toBe(true);
  });

  it("settings master 0.5 persists through loadSave", () => {
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

  it("results shows retry/next from a setLastResult handoff", () => {
    gameState.setLastResult({
      event_id: "harbor_sprint",
      player_racer: "player",
      places: [
        { racer: "player", time_s: 80.0, place: 1 },
        { racer: "ai_1", time_s: 85.2, place: 2 },
      ],
    });
    const { element, stub } = makeContainer(doc);
    const router = makeRouter(element);
    router.show("results");
    expect(findById(stub, "screen-results")).not.toBeNull();
    expect(findById(stub, "btn-retry")).not.toBeNull();
    expect(findById(stub, "btn-next")).not.toBeNull();
  });
});
