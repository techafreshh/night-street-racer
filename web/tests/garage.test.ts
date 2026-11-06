// Garage four-tuner contract suite (issue #221): palette wrap, lock
// matrix, requirement text, stat labels, four-card render, and the
// coupe + color 2 persist round-trip. Stub-DOM tests with no browser,
// no WebGL, no WASM.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { gameState } from "../src/game/state";
import { defaultSave, loadSave, saveNow } from "../src/game/save";
import {
  CAR_IDS,
  COLOR_COUNT,
  isCarUnlockedWith,
  is_car_unlocked_with,
  renderGarage,
  statLabelFor,
  stat_label_for,
  stopGaragePreviews,
  unlockRequirementFor,
  unlock_requirement_for,
} from "../src/ui/garage";
import {
  COLORS,
  COLOR_COUNT as PAINT_COUNT,
  colorCss,
  colorFor,
  color_css,
  color_for,
} from "../src/vehicles/paint";

type StubNode = {
  tagName: string;
  id: string;
  className: string;
  textContent: string | null;
  disabled: boolean;
  hidden: boolean;
  style: Record<string, string>;
  width: number;
  height: number;
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
    className: "",
    textContent: "",
    disabled: false,
    hidden: false,
    style: {},
    width: 0,
    height: 0,
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

function findByClass(root: StubNode, cls: string): StubNode[] {
  const out: StubNode[] = [];
  const classes = root.className.split(" ").filter((part) => part !== "");
  if (classes.includes(cls)) {
    out.push(root);
  }
  for (const child of root.children) {
    out.push(...findByClass(child, cls));
  }
  return out;
}

function textTree(node: StubNode | null): string {
  if (node === null) {
    return "";
  }
  let text = node.textContent ?? "";
  for (const child of node.children) {
    text += ` ${textTree(child)}`;
  }
  return text;
}

function resetAll(): void {
  saveNow(defaultSave());
  gameState.reloadFromDisk();
  gameState.clearLastResult();
  stopGaragePreviews();
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

describe("paint palette", () => {
  it("carries four transcribed variants", () => {
    expect(COLORS).toEqual(["#2659F2", "#F2661A", "#BFC2CC", "#1A9933"]);
    expect(COLOR_COUNT).toBe(4);
    expect(PAINT_COUNT).toBe(4);
  });

  it("wraps out-of-range indexes with posmod", () => {
    expect(colorFor(0)).toBe(COLORS[0]);
    expect(colorFor(3)).toBe(COLORS[3]);
    expect(colorFor(4)).toBe(COLORS[0]);
    expect(colorFor(-1)).toBe(COLORS[3]);
    expect(colorCss(5)).toBe(COLORS[1]);
    expect(color_for).toBe(colorFor);
    expect(color_css).toBe(colorCss);
  });
});

describe("garage locks", () => {
  it("leaves the sedan open while the coupe boots locked", () => {
    expect(isCarUnlockedWith("sedan", [])).toBe(true);
    expect(isCarUnlockedWith("coupe", [])).toBe(false);
    expect(isCarUnlockedWith("coupe", ["coupe"])).toBe(true);
    expect(isCarUnlockedWith("awd", [])).toBe(false);
    expect(is_car_unlocked_with).toBe(isCarUnlockedWith);
  });

  it("names the awarding event in the requirement text", () => {
    expect(unlockRequirementFor("sedan", [])).toBe("");
    expect(unlockRequirementFor("coupe", [])).toContain("Win");
    expect(unlockRequirementFor("coupe", [])).toContain("harbor_sprint");
    expect(unlockRequirementFor("hatch", [])).toContain("downtown_gp");
    expect(unlockRequirementFor("awd", [])).toContain("neon_loop");
    expect(unlockRequirementFor("coupe", ["coupe"])).toBe("");
    expect(unlockRequirementFor("mystery", [])).toBe("Win a race to unlock");
    expect(unlock_requirement_for).toBe(unlockRequirementFor);
  });

  it("builds stat labels from the live tunes", () => {
    expect(statLabelFor("sedan")).toContain("380");
    expect(statLabelFor("sedan")).toContain("RWD");
    expect(statLabelFor("nope")).toBe("nope");
    expect(stat_label_for).toBe(statLabelFor);
  });
});

describe("garage render", () => {
  it("renders exactly four car cards", () => {
    const stub = doc.createElement("div");
    renderGarage(stub as unknown as HTMLElement, null);
    expect(findByClass(stub, "car-card")).toHaveLength(4);
    for (const carId of CAR_IDS) {
      expect(findById(stub, `car-card-${carId}`)).not.toBeNull();
    }
  });

  it("gives each card a preview canvas and a select button", () => {
    const stub = doc.createElement("div");
    renderGarage(stub as unknown as HTMLElement, null);
    for (const carId of CAR_IDS) {
      const card = findById(stub, `car-card-${carId}`);
      expect(card).not.toBeNull();
      const canvases = (card as StubNode).children.filter(
        (child) => child.tagName === "CANVAS",
      );
      expect(canvases).toHaveLength(1);
      expect(canvases[0].className.split(" ")).toContain("car-preview");
      expect(findById(card as StubNode, `btn-select-${carId}`)).not.toBeNull();
    }
    for (let color = 0; color < 4; color += 1) {
      expect(findById(stub, `btn-color-${color}`)).not.toBeNull();
    }
  });

  it("locks the awd card behind a Win requirement with a disabled select", () => {
    const stub = doc.createElement("div");
    renderGarage(stub as unknown as HTMLElement, null);
    const card = findById(stub, "car-card-awd");
    expect(card).not.toBeNull();
    expect(textTree(card)).toContain("Win");
    expect(findById(card as StubNode, "btn-select-awd")?.disabled).toBe(true);
    expect(findById(stub, "btn-select-sedan")?.disabled).toBe(false);
  });

  it("persists coupe plus color 2 through a reload round-trip", () => {
    gameState.applyResult("harbor_sprint", 1);
    const stub = doc.createElement("div");
    renderGarage(stub as unknown as HTMLElement, null);
    findById(stub, "btn-select-coupe")?.click();
    findById(stub, "btn-color-2")?.click();
    gameState.flush();
    const saved = loadSave();
    expect(saved.progress.selected_car).toBe("coupe");
    expect(saved.progress.selected_color).toBe(2);
  });
});
