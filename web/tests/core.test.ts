// Core contract suite (run_all.gd idiom: fail-loud, exit-code gated).
// Covers the issue #205 acceptance surface with no padding: emitter
// exactly-once delivery plus off(), router container swap plus
// unknown-route throw, math boundaries, and loop step-count versus
// paused step-count with stubbed rAF. No network, no WebGL, no DOM.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRaceEmitter } from "../src/core/events";
import { STEP_DT, start } from "../src/core/loop";
import { clamp, lerp, wrapAngle } from "../src/core/math";
import { Router } from "../src/core/router";

describe("race emitter", () => {
  it("delivers onRaceStateChanged exactly once", () => {
    const emitter = createRaceEmitter();
    let calls = 0;
    emitter.on("onRaceStateChanged", () => {
      calls += 1;
    });
    emitter.emit("onRaceStateChanged", { state: "racing" });
    expect(calls).toBe(1);
  });

  it("off silences the subscriber", () => {
    const emitter = createRaceEmitter();
    let calls = 0;
    const handler = (): void => {
      calls += 1;
    };
    emitter.on("onRaceStateChanged", handler);
    emitter.off("onRaceStateChanged", handler);
    emitter.emit("onRaceStateChanged", { state: "finished" });
    expect(calls).toBe(0);
  });

  it("delivers the onCheckpoint payload", () => {
    const emitter = createRaceEmitter();
    const seen: number[] = [];
    emitter.on("onCheckpoint", (payload) => {
      seen.push(payload.index);
    });
    emitter.emit("onCheckpoint", { index: 2 });
    expect(seen).toEqual([2]);
  });
});

describe("screen router", () => {
  interface StubContainer {
    nodes: string[];
    replaceChildren(...nodes: string[]): void;
  }

  function makeContainer(): { element: HTMLElement; stub: StubContainer } {
    const stub: StubContainer = {
      nodes: [],
      replaceChildren(...nodes: string[]): void {
        stub.nodes.length = 0;
        stub.nodes.push(...nodes);
      },
    };
    return { element: stub as unknown as HTMLElement, stub };
  }

  function paint(name: string): (container: HTMLElement) => void {
    return (container: HTMLElement): void => {
      (container as unknown as StubContainer).replaceChildren(name);
    };
  }

  it("swaps container content and tracks current()", () => {
    const { element, stub } = makeContainer();
    const router = new Router(element);
    router.register("menu", paint("menu-screen"));
    router.register("race", paint("race-screen"));
    router.show("menu");
    expect(router.current()).toBe("menu");
    expect(stub.nodes).toEqual(["menu-screen"]);
    router.show("race");
    expect(router.current()).toBe("race");
    expect(stub.nodes).toEqual(["race-screen"]);
  });

  it("throws on unknown screens", () => {
    const { element } = makeContainer();
    const router = new Router(element);
    router.register("menu", paint("menu-screen"));
    expect(() => router.show("bogus")).toThrow("Unknown screen: bogus");
  });
});

describe("math helpers", () => {
  it("clamps to the closed range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
    expect(clamp(4.5, 0, 10)).toBe(4.5);
  });

  it("lerps across boundary blends", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(-4, 4, 0.25)).toBe(-2);
  });

  it("wraps angles to [-PI, PI]", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI)).toBe(-Math.PI);
    expect(wrapAngle(2 * Math.PI)).toBeCloseTo(0, 10);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 10);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI, 10);
  });
});

describe("fixed-step loop", () => {
  let rafQueue: Array<(now: number) => void>;
  let now: number;

  beforeEach(() => {
    rafQueue = [];
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void): number => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (): void => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function pumpFrames(count: number): void {
    for (let i = 0; i < count; i += 1) {
      now += 1000 / 60;
      const pending = rafQueue;
      rafQueue = [];
      for (const callback of pending) {
        callback(now);
      }
    }
  }

  it("uses a 1/60 fixed step", () => {
    expect(STEP_DT).toBeCloseTo(1 / 60, 12);
  });

  it("advances about one step per frame while unpaused", () => {
    let steps = 0;
    const handle = start(() => {
      steps += 1;
    });
    expect(handle.isPaused()).toBe(false);
    pumpFrames(120);
    expect(steps).toBeGreaterThanOrEqual(119);
    expect(steps).toBeLessThanOrEqual(121);
    handle.stop();
  });

  it("gates stepping while paused and resumes cleanly", () => {
    let steps = 0;
    const handle = start(() => {
      steps += 1;
    });
    pumpFrames(60);
    const beforePause = steps;
    expect(beforePause).toBeGreaterThan(0);
    handle.setPaused(true);
    expect(handle.isPaused()).toBe(true);
    pumpFrames(60);
    expect(steps).toBe(beforePause);
    handle.setPaused(false);
    expect(handle.isPaused()).toBe(false);
    pumpFrames(60);
    expect(steps).toBeGreaterThan(beforePause);
    expect(steps - beforePause).toBeGreaterThanOrEqual(59);
    expect(steps - beforePause).toBeLessThanOrEqual(61);
    handle.stop();
  });
});
