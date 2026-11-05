// Player input acceptance suite (player_input.gd bridge idiom).
// Keyboard plus virtual gamepad merge into one polled table: throttle,
// deadzone steer, consume-once pause/reset edges, plus a readFileSync
// hygiene scan proving the module stays three.js-free with no top-level
// window/navigator dereference. No browser, no WebGL, no network.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { start } from "../src/core/loop";
import {
  applyDeadzone,
  apply_deadzone,
  create_player_input,
  createInputState,
  createPlayerInput,
  DEADZONE,
  input,
  type PlayerInput,
} from "../src/vehicles/input";

type VirtualButton = { pressed: boolean; value: number };
type VirtualPad = { buttons: VirtualButton[]; axes: number[] };

function makePad(): VirtualPad {
  return {
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
}

function pressButton(pad: VirtualPad, index: number, value = 1): void {
  pad.buttons[index] = { pressed: true, value };
}

function freshPlayer(): { player: PlayerInput; pad: VirtualPad } {
  const pad = makePad();
  const player = createPlayerInput();
  player.setGamepadOverride(() => [pad]);
  return { player, pad };
}

describe("deadzone", () => {
  it("uses a 0.2 cutoff", () => {
    expect(DEADZONE).toBe(0.2);
  });

  it("cuts small deflections and renormalizes the rest", () => {
    expect(applyDeadzone(0.1)).toBe(0);
    expect(applyDeadzone(-0.1)).toBe(0);
    expect(applyDeadzone(0.19)).toBe(0);
    expect(applyDeadzone(0.2)).toBe(0);
    expect(applyDeadzone(0.5)).toBeCloseTo(0.375, 10);
    expect(applyDeadzone(-0.5)).toBeCloseTo(-0.375, 10);
    expect(applyDeadzone(1)).toBe(1);
    expect(applyDeadzone(-1)).toBe(-1);
    expect(applyDeadzone(2)).toBe(1);
    expect(applyDeadzone(Number.NaN)).toBe(0);
  });

  it("exposes the snake_case alias", () => {
    expect(apply_deadzone).toBe(applyDeadzone);
  });
});

describe("keyboard throttle and brake", () => {
  it("reads KeyW eagerly as throttle 1", () => {
    const { player } = freshPlayer();
    player.setKey("KeyW", true);
    expect(player.state.throttle).toBe(1);
    expect(player.throttle).toBe(1);
    expect(player.state.accelerate).toBe(1);
    player.setKey("KeyW", false);
    player.poll();
    expect(player.state.throttle).toBe(0);
  });

  it("reads ArrowUp as throttle 1", () => {
    const { player } = freshPlayer();
    player.setKey("ArrowUp", true);
    player.poll();
    expect(player.state.throttle).toBe(1);
  });

  it("reads KeyS and ArrowDown as brake 1", () => {
    const { player } = freshPlayer();
    player.setKey("KeyS", true);
    player.poll();
    expect(player.state.brake).toBe(1);
    player.setKey("KeyS", false);
    player.setKey("ArrowDown", true);
    player.poll();
    expect(player.state.brake).toBe(1);
  });
});

describe("keyboard steer", () => {
  it("reads KeyA/KeyD as -1/1 and cancels when both are held", () => {
    const { player } = freshPlayer();
    player.setKey("KeyA", true);
    player.poll();
    expect(player.state.steer).toBe(-1);
    player.setKey("KeyD", true);
    player.poll();
    expect(player.state.steer).toBe(0);
    player.setKey("KeyA", false);
    player.poll();
    expect(player.state.steer).toBe(1);
  });

  it("reads the arrow keys as steer", () => {
    const { player } = freshPlayer();
    player.setKey("ArrowLeft", true);
    player.poll();
    expect(player.state.steer).toBe(-1);
    player.setKey("ArrowLeft", false);
    player.setKey("ArrowRight", true);
    player.poll();
    expect(player.state.steer).toBe(1);
  });
});

describe("keyboard held flags", () => {
  it("reads Space as handbrake", () => {
    const { player } = freshPlayer();
    player.setKey("Space", true);
    player.poll();
    expect(player.state.handbrake).toBe(true);
    player.setKey("Space", false);
    player.poll();
    expect(player.state.handbrake).toBe(false);
  });

  it("reads KeyC as lookBack plus the snake_case alias", () => {
    const { player } = freshPlayer();
    player.setKey("KeyC", true);
    player.poll();
    expect(player.state.lookBack).toBe(true);
    expect(player.state.look_back).toBe(true);
    expect(player.lookBack).toBe(true);
  });

  it("reads KeyR as held reset", () => {
    const { player } = freshPlayer();
    player.setKey("KeyR", true);
    player.poll();
    expect(player.state.reset).toBe(true);
    player.setKey("KeyR", false);
    player.poll();
    expect(player.state.reset).toBe(false);
  });

  it("reads Escape as held pause", () => {
    const { player } = freshPlayer();
    player.setKey("Escape", true);
    player.poll();
    expect(player.state.pause).toBe(true);
  });
});

describe("pause edge latch", () => {
  it("fires Escape exactly once across two polls and two reads", () => {
    const { player } = freshPlayer();
    player.setKey("Escape", true);
    player.poll();
    player.poll();
    expect(player.state.pausePressed).toBe(true);
    expect(player.state.pausePressed).toBe(false);
    expect(player.pausePressed).toBe(false);
    player.setKey("Escape", false);
    player.poll();
    expect(player.state.pausePressed).toBe(false);
  });

  it("fires again on the next press after release", () => {
    const { player } = freshPlayer();
    player.setKey("Escape", true);
    expect(player.state.pausePressed).toBe(true);
    player.setKey("Escape", false);
    player.poll();
    player.setKey("Escape", true);
    expect(player.state.pausePressed).toBe(true);
    expect(player.state.pause_pressed).toBe(false);
  });

  it("shares one latch between pausePressed and pause_pressed", () => {
    const { player } = freshPlayer();
    player.setKey("Escape", true);
    expect(player.state.pausePressed).toBe(true);
    expect(player.state.pause_pressed).toBe(false);
  });
});

describe("reset edge latch", () => {
  it("fires KeyR exactly once while held", () => {
    const { player } = freshPlayer();
    player.setKey("KeyR", true);
    player.poll();
    player.poll();
    expect(player.state.resetPressed).toBe(true);
    expect(player.state.resetPressed).toBe(false);
    expect(player.reset_pressed).toBe(false);
  });
});

describe("gamepad triggers and stick", () => {
  it("reads RT 0.7 as throttle 0.7", () => {
    const { player, pad } = freshPlayer();
    pressButton(pad, 7, 0.7);
    player.poll();
    expect(player.state.throttle).toBe(0.7);
  });

  it("reads LT as brake", () => {
    const { player, pad } = freshPlayer();
    pressButton(pad, 6, 0.6);
    player.poll();
    expect(player.state.brake).toBe(0.6);
  });

  it("applies the 0.2 deadzone to the stick", () => {
    const { player, pad } = freshPlayer();
    pad.axes[0] = 0.1;
    player.poll();
    expect(player.state.steer).toBe(0);
    pad.axes[0] = 0.5;
    player.poll();
    expect(player.state.steer).toBeCloseTo(0.375, 10);
    pad.axes[0] = -0.5;
    player.poll();
    expect(player.state.steer).toBeCloseTo(-0.375, 10);
  });

  it("reads the D-pad as digital steer", () => {
    const { player, pad } = freshPlayer();
    pressButton(pad, 14);
    player.poll();
    expect(player.state.steer).toBe(-1);
    pad.buttons[14] = { pressed: false, value: 0 };
    pressButton(pad, 15);
    player.poll();
    expect(player.state.steer).toBe(1);
  });

  it("takes the first non-null pad", () => {
    const pad = makePad();
    pad.axes[0] = 0.5;
    const player = createPlayerInput();
    player.setGamepadOverride(() => [null, pad]);
    player.poll();
    expect(player.state.steer).toBeCloseTo(0.375, 10);
  });
});

describe("gamepad buttons", () => {
  it("reads B as handbrake", () => {
    const { player, pad } = freshPlayer();
    pressButton(pad, 1);
    player.poll();
    expect(player.state.handbrake).toBe(true);
  });

  it("reads LB as lookBack", () => {
    const { player, pad } = freshPlayer();
    pressButton(pad, 4);
    player.poll();
    expect(player.state.lookBack).toBe(true);
    expect(player.state.look_back).toBe(true);
  });

  it("reads Start as a pause edge exactly once", () => {
    const { player, pad } = freshPlayer();
    pressButton(pad, 9);
    player.poll();
    player.poll();
    expect(player.state.pausePressed).toBe(true);
    expect(player.state.pausePressed).toBe(false);
  });

  it("reads either stick click as a reset edge exactly once", () => {
    for (const index of [10, 11]) {
      const { player, pad } = freshPlayer();
      pressButton(pad, index);
      player.poll();
      player.poll();
      expect(player.state.resetPressed).toBe(true);
      expect(player.state.resetPressed).toBe(false);
    }
  });
});

describe("source combining", () => {
  it("takes the max of keyboard and trigger", () => {
    const { player, pad } = freshPlayer();
    pressButton(pad, 7, 0.7);
    player.poll();
    expect(player.state.throttle).toBe(0.7);
    player.setKey("KeyW", true);
    player.poll();
    expect(player.state.throttle).toBe(1);
  });

  it("clamps stick plus digital steer into [-1, 1]", () => {
    const { player, pad } = freshPlayer();
    pad.axes[0] = 0.5;
    player.setKey("KeyD", true);
    player.poll();
    expect(player.state.steer).toBe(1);
    player.setKey("KeyD", false);
    player.setKey("KeyA", true);
    player.poll();
    expect(player.state.steer).toBeCloseTo(-0.625, 10);
  });
});

describe("state ownership", () => {
  it("keeps the same state object across polls", () => {
    const { player } = freshPlayer();
    const first = player.state;
    player.poll();
    player.poll();
    expect(player.state).toBe(first);
  });

  it("zeroes a fresh table", () => {
    const state = createInputState();
    expect(state.throttle).toBe(0);
    expect(state.accelerate).toBe(0);
    expect(state.brake).toBe(0);
    expect(state.steer).toBe(0);
    expect(state.handbrake).toBe(false);
    expect(state.lookBack).toBe(false);
    expect(state.look_back).toBe(false);
    expect(state.reset).toBe(false);
    expect(state.pause).toBe(false);
    expect(state.resetPressed).toBe(false);
    expect(state.reset_pressed).toBe(false);
    expect(state.pausePressed).toBe(false);
    expect(state.pause_pressed).toBe(false);
  });

  it("exposes the snake_case factory alias", () => {
    expect(create_player_input).toBe(createPlayerInput);
  });

  it("imports the singleton with no window or gamepad present", () => {
    expect(typeof window).toBe("undefined");
    expect(input.state.throttle).toBe(0);
    expect(() => input.poll()).not.toThrow();
    expect(() => input.attach()).not.toThrow();
    expect(() => input.dispose()).not.toThrow();
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

  it("polls the table once per fixed step", () => {
    const { player } = freshPlayer();
    let steps = 0;
    const handle = start(() => {
      player.poll();
      steps += 1;
    });
    player.setKey("KeyW", true);
    pumpFrames(30);
    expect(steps).toBeGreaterThan(0);
    expect(player.state.throttle).toBe(1);
    player.setKey("Escape", true);
    pumpFrames(2);
    expect(player.pausePressed).toBe(true);
    expect(player.pausePressed).toBe(false);
    handle.stop();
  });
});

describe("input module hygiene", () => {
  it("imports no three.js and touches no window/navigator at the top level", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "vehicles");
    const text = readFileSync(join(root, "input.ts"), "utf8");
    expect(text).not.toMatch(/from\s+["']three["']/);
    const topLevel = text.split("\n").filter((line) => /^(window|navigator)\b/.test(line));
    expect(topLevel).toEqual([]);
  });
});
