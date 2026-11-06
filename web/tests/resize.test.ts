// Scene resize listener acceptance suite (issue #245 contract).
// Proves the stored-handler attach/dispose pair in render/renderer.ts
// keeps exactly one live window resize listener across re-inits, drops
// it on dispose, never throws (including without a window), and stays
// Node-safe with no top-level window dereference. No browser, no WebGL.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachSceneResize,
  attach_scene_resize,
  disposeSceneResize,
  dispose_scene_resize,
} from "../src/render/renderer";

type ResizeListener = () => void;

type WindowStub = {
  listeners: Map<string, Set<ResizeListener>>;
  addEventListener: (type: string, handler: ResizeListener) => void;
  removeEventListener: (type: string, handler: ResizeListener) => void;
  dispatch: (type: string) => void;
  liveCount: (type: string) => number;
};

function makeWindowStub(): WindowStub {
  const listeners = new Map<string, Set<ResizeListener>>();
  const stub: WindowStub = {
    listeners,
    addEventListener: (type: string, handler: ResizeListener): void => {
      let bucket = listeners.get(type);
      if (bucket === undefined) {
        bucket = new Set<ResizeListener>();
        listeners.set(type, bucket);
      }
      bucket.add(handler);
    },
    removeEventListener: (type: string, handler: ResizeListener): void => {
      listeners.get(type)?.delete(handler);
    },
    dispatch: (type: string): void => {
      const bucket = listeners.get(type);
      if (bucket === undefined) {
        return;
      }
      for (const handler of [...bucket]) {
        handler();
      }
    },
    liveCount: (type: string): number => listeners.get(type)?.size ?? 0,
  };
  stub.addEventListener = vi.fn(stub.addEventListener);
  stub.removeEventListener = vi.fn(stub.removeEventListener);
  return stub;
}

function stubWindow(): WindowStub {
  const stub = makeWindowStub();
  vi.stubGlobal("window", stub);
  return stub;
}

afterEach(() => {
  try {
    disposeSceneResize();
  } catch {
    // Disposal never throws; the sweep below unstubs first-safe too.
  }
  vi.unstubAllGlobals();
  try {
    disposeSceneResize();
  } catch {
    // No-window disposal never throws.
  }
});

describe("aliases", () => {
  it("exposes the snake_case twins as the same reference", () => {
    expect(attach_scene_resize).toBe(attachSceneResize);
    expect(dispose_scene_resize).toBe(disposeSceneResize);
  });
});

describe("attach dedupes re-inits", () => {
  it("replaces the first listener so only the newest fires", () => {
    const stub = stubWindow();
    const first = vi.fn();
    const second = vi.fn();
    attachSceneResize(first);
    attachSceneResize(second);
    stub.dispatch("resize");
    expect(first).toHaveBeenCalledTimes(0);
    expect(second).toHaveBeenCalledTimes(1);
    expect(stub.liveCount("resize")).toBe(1);
    expect(stub.removeEventListener).toHaveBeenCalledWith("resize", first);
  });

  it("keeps exactly one live listener after any number of inits", () => {
    const stub = stubWindow();
    const calls: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const index = i;
      attachSceneResize(() => {
        calls.push(index);
      });
    }
    stub.dispatch("resize");
    expect(calls).toEqual([4]);
    expect(stub.liveCount("resize")).toBe(1);
  });

  it("ignores non-function handlers without adding a listener", () => {
    const stub = stubWindow();
    expect(() =>
      attachSceneResize(null as unknown as ResizeListener),
    ).not.toThrow();
    expect(() =>
      attachSceneResize("resize" as unknown as ResizeListener),
    ).not.toThrow();
    expect(stub.liveCount("resize")).toBe(0);
    expect(stub.addEventListener).not.toHaveBeenCalled();
  });

  it("returns a per-call remover that drops only its own handler", () => {
    const stub = stubWindow();
    const first = vi.fn();
    const second = vi.fn();
    const removeFirst = attachSceneResize(first);
    const removeSecond = attachSceneResize(second);
    expect(() => removeFirst()).not.toThrow();
    stub.dispatch("resize");
    expect(first).toHaveBeenCalledTimes(0);
    expect(second).toHaveBeenCalledTimes(1);
    expect(stub.liveCount("resize")).toBe(1);
    expect(() => removeSecond()).not.toThrow();
    stub.dispatch("resize");
    expect(second).toHaveBeenCalledTimes(1);
    expect(stub.liveCount("resize")).toBe(0);
  });
});

describe("dispose", () => {
  it("leaves zero listeners and silences the old handler", () => {
    const stub = stubWindow();
    const handler = vi.fn();
    attachSceneResize(handler);
    expect(stub.liveCount("resize")).toBe(1);
    expect(() => disposeSceneResize()).not.toThrow();
    expect(stub.liveCount("resize")).toBe(0);
    stub.dispatch("resize");
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it("is double-call safe and safe with no listeners", () => {
    stubWindow();
    expect(() => disposeSceneResize()).not.toThrow();
    expect(() => disposeSceneResize()).not.toThrow();
    const stub = stubWindow();
    const handler = vi.fn();
    attachSceneResize(handler);
    disposeSceneResize();
    disposeSceneResize();
    stub.dispatch("resize");
    expect(handler).toHaveBeenCalledTimes(0);
    expect(stub.liveCount("resize")).toBe(0);
  });

  it("is safe with no window and attach without a window never throws", () => {
    vi.unstubAllGlobals();
    expect(typeof window).toBe("undefined");
    expect(() => disposeSceneResize()).not.toThrow();
    expect(() => disposeSceneResize()).not.toThrow();
    let remover: (() => void) | null = null;
    expect(() => {
      remover = attachSceneResize(() => {});
    }).not.toThrow();
    expect(typeof remover).toBe("function");
    expect(() => (remover as unknown as () => void)()).not.toThrow();
  });

  it("survives repeated attach/dispose cycles without throwing", () => {
    const stub = stubWindow();
    for (let i = 0; i < 10; i += 1) {
      const handler = vi.fn();
      const remover = attachSceneResize(handler);
      stub.dispatch("resize");
      expect(handler).toHaveBeenCalledTimes(1);
      remover();
      disposeSceneResize();
    }
    expect(stub.liveCount("resize")).toBe(0);
  });
});

describe("module hygiene", () => {
  it("touches no window/navigator at the top level of renderer.ts", () => {
    const root = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "render",
    );
    const text = readFileSync(join(root, "renderer.ts"), "utf8");
    const topLevel = text
      .split("\n")
      .filter((line) => /^(window|navigator)\b/.test(line));
    expect(topLevel).toEqual([]);
  });

  it("adds no new three import to renderer.ts", () => {
    const root = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "render",
    );
    const text = readFileSync(join(root, "renderer.ts"), "utf8");
    const matches = text.match(/from\s+["']three["']/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("rewires main.ts to the helpers with a disposer and an HMR hook", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const text = readFileSync(join(root, "main.ts"), "utf8");
    expect(text).not.toMatch(/sceneResizeHandler/);
    expect(text).toMatch(/attachSceneResize/);
    expect(text).toMatch(/disposeSceneResize/);
    expect(text).toMatch(/export function disposeScene/);
    expect(text).toMatch(/import\.meta\.hot/);
  });
});
