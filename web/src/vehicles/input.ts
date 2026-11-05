// Player keyboard-plus-gamepad input table (player_input.gd bridge port).
// With no vehicle present this module only owns the polled InputState
// table; with a vehicle present the table shape
// (throttle/brake/steer/handbrake/reset) matches the `_sample_inputs` seam
// in scripts/vehicles/vehicle_controller.gd and the AI bridge in
// scripts/ai/ai_input.gd (which never reads InputMap). Keyboard (`e.code`)
// and standard-mapping gamepads (`navigator.getGamepads()`) merge into one
// table every fixed step. Window-free by design: no DOM is touched at
// import time so Node/vitest can inject a virtual gamepad.

export const DEADZONE = 0.2;

// Keyboard vocabulary: `e.code` values (layout-independent, so KeyW stays
// KeyW on AZERTY where `key` would read "z").
export const CODE_THROTTLE = "KeyW";
export const CODE_THROTTLE_ALT = "ArrowUp";
export const CODE_BRAKE = "KeyS";
export const CODE_BRAKE_ALT = "ArrowDown";
export const CODE_STEER_LEFT = "KeyA";
export const CODE_STEER_LEFT_ALT = "ArrowLeft";
export const CODE_STEER_RIGHT = "KeyD";
export const CODE_STEER_RIGHT_ALT = "ArrowRight";
export const CODE_HANDBRAKE = "Space";
export const CODE_LOOK_BACK = "KeyC";
export const CODE_RESET = "KeyR";
export const CODE_PAUSE = "Escape";

// Standard-mapping gamepad vocabulary: indices into buttons[]/axes[].
// Shoulder/trigger/stick mapping mirrors the Godot InputMap in
// project.godot (look_back LB, reset both stick clicks, pause Start,
// handbrake B, steer D-pad plus left stick, accelerate/brake triggers).
export const PAD_AXIS_STEER = 0;
export const PAD_HANDBRAKE = 1;
export const PAD_LOOK_BACK = 4;
export const PAD_BRAKE_TRIGGER = 6;
export const PAD_THROTTLE_TRIGGER = 7;
export const PAD_PAUSE = 9;
export const PAD_RESET_LEFT = 10;
export const PAD_RESET_RIGHT = 11;
export const PAD_STEER_LEFT = 14;
export const PAD_STEER_RIGHT = 15;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

// Deadzone with renormalization: |v| < DEADZONE reads 0, otherwise
// (|v| - DEADZONE) / (1 - DEADZONE) with the sign kept, clamped to
// [-1, 1]. Non-finite input reads 0.
export function applyDeadzone(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  const magnitude = Math.abs(value);
  if (magnitude < DEADZONE) {
    return 0;
  }
  const scaled = (magnitude - DEADZONE) / (1 - DEADZONE);
  const capped = Math.min(scaled, 1);
  return value < 0 ? -capped : capped;
}

// v1 snake_case alias (same reference).
export const apply_deadzone = applyDeadzone;

// Polled input table. Dual vocabulary (throttle/accelerate,
// lookBack/look_back, resetPressed/reset_pressed,
// pausePressed/pause_pressed) so harness wording cannot mismatch: each
// snake_case member is an accessor over the same backing field.
// pausePressed/resetPressed are consume-once rising-edge latches: a read
// returns the pending press and clears it, so each press reads true
// exactly once.
export type InputState = {
  throttle: number;
  accelerate: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  lookBack: boolean;
  look_back: boolean;
  reset: boolean;
  pause: boolean;
  resetPressed: boolean;
  reset_pressed: boolean;
  pausePressed: boolean;
  pause_pressed: boolean;
};

// Fresh zeroed table with the dual-vocabulary accessors bound to one
// backing store. Each call returns an independent object.
export function createInputState(): InputState {
  let pauseLatch = false;
  let resetLatch = false;
  const state = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    lookBack: false,
    reset: false,
    pause: false,
  } as InputState;
  Object.defineProperties(state, {
    accelerate: {
      enumerable: true,
      configurable: true,
      get: (): number => state.throttle,
      set: (value: number): void => {
        state.throttle = value;
      },
    },
    look_back: {
      enumerable: true,
      configurable: true,
      get: (): boolean => state.lookBack,
      set: (value: boolean): void => {
        state.lookBack = value;
      },
    },
    resetPressed: {
      enumerable: true,
      configurable: true,
      get: (): boolean => {
        const pending = resetLatch;
        resetLatch = false;
        return pending;
      },
      set: (value: boolean): void => {
        resetLatch = value;
      },
    },
    reset_pressed: {
      enumerable: true,
      configurable: true,
      get: (): boolean => {
        const pending = resetLatch;
        resetLatch = false;
        return pending;
      },
      set: (value: boolean): void => {
        resetLatch = value;
      },
    },
    pausePressed: {
      enumerable: true,
      configurable: true,
      get: (): boolean => {
        const pending = pauseLatch;
        pauseLatch = false;
        return pending;
      },
      set: (value: boolean): void => {
        pauseLatch = value;
      },
    },
    pause_pressed: {
      enumerable: true,
      configurable: true,
      get: (): boolean => {
        const pending = pauseLatch;
        pauseLatch = false;
        return pending;
      },
      set: (value: boolean): void => {
        pauseLatch = value;
      },
    },
  });
  return state;
}

// Minimal structural gamepad shape: real Gamepad objects satisfy this.
// Buttons may be sparse (holes read as released) for virtual pads.
export type PadButton = {
  pressed: boolean;
  value: number;
};

export type Pad = {
  buttons: ArrayLike<PadButton | null | undefined>;
  axes: ArrayLike<number | null | undefined>;
};

// Injectable gamepad list: the default reads the live browser list, tests
// inject a function returning virtual pads. First non-null entry wins.
export type GamepadSource = () => ArrayLike<Pad | null | undefined> | null | undefined;

// Default adapter: the live `navigator.getGamepads()` list when present,
// otherwise null. Lazy by design: safe to construct under Node where no
// `navigator` exists; only called from `poll()`, never at import time.
export function getDefaultGamepadSource(): GamepadSource {
  return (): ArrayLike<Pad | null | undefined> | null | undefined => {
    try {
      if (typeof navigator === "undefined" || navigator === null) {
        return null;
      }
      const get = navigator.getGamepads;
      if (typeof get !== "function") {
        return null;
      }
      const pads = get.call(navigator) as unknown as
        | ArrayLike<Pad | null | undefined>
        | null
        | undefined;
      return pads ?? null;
    } catch {
      return null;
    }
  };
}

function readPad(source: GamepadSource | null | undefined): Pad | null {
  if (source === null || source === undefined) {
    return null;
  }
  try {
    const list = source();
    if (list === null || list === undefined) {
      return null;
    }
    for (let i = 0; i < list.length; i += 1) {
      const pad = list[i];
      if (pad !== null && pad !== undefined) {
        return pad;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function buttonRawValue(pad: Pad | null, index: number): number {
  if (pad === null || pad === undefined) {
    return 0;
  }
  try {
    const buttons = pad.buttons;
    if (buttons === null || buttons === undefined) {
      return 0;
    }
    const button = buttons[index];
    if (button === null || button === undefined) {
      return 0;
    }
    if (typeof button.value === "number" && Number.isFinite(button.value)) {
      return button.value;
    }
    return button.pressed === true ? 1 : 0;
  } catch {
    return 0;
  }
}

// Digital button: pressed flag wins, analog-style value threshold covers
// virtual pads that only set `value`.
function padButtonDown(pad: Pad | null, index: number): boolean {
  if (pad === null || pad === undefined) {
    return false;
  }
  try {
    const buttons = pad.buttons;
    if (buttons === null || buttons === undefined) {
      return false;
    }
    const button = buttons[index];
    if (button === null || button === undefined) {
      return false;
    }
    if (button.pressed === true) {
      return true;
    }
    return (
      typeof button.value === "number" &&
      Number.isFinite(button.value) &&
      button.value >= 0.5
    );
  } catch {
    return false;
  }
}

// Analog trigger: Godot action-deadzone cutoff (below DEADZONE reads 0),
// raw value above (no stick-style renormalization, so 0.7 stays 0.7).
function padTriggerValue(pad: Pad | null, index: number): number {
  const raw = buttonRawValue(pad, index);
  if (raw < DEADZONE) {
    return 0;
  }
  return clamp(raw, 0, 1);
}

function padAxisValue(pad: Pad | null, index: number): number {
  if (pad === null || pad === undefined) {
    return 0;
  }
  try {
    const axes = pad.axes;
    if (axes === null || axes === undefined) {
      return 0;
    }
    const value = axes[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return value;
  } catch {
    return 0;
  }
}

export type PlayerInputOptions = {
  keys?: Set<string>;
  source?: GamepadSource;
};

// Polled keyboard-plus-gamepad input table (player_input.gd bridge port).
// Owns one mutable InputState and merges `e.code` keys plus the
// standard-mapping gamepad into it on every `poll()`; the same state
// object is mutated in place so probes can hold the reference.
export class PlayerInput {
  readonly state: InputState;
  private readonly keys: Set<string>;
  private source: GamepadSource;
  private prevPauseDown = false;
  private prevResetDown = false;
  private keyDownHandler: ((event: KeyboardEvent) => void) | null = null;
  private keyUpHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(options?: PlayerInputOptions) {
    this.keys = options?.keys ?? new Set<string>();
    this.source = options?.source ?? getDefaultGamepadSource();
    this.state = createInputState();
  }

  get throttle(): number {
    return this.state.throttle;
  }

  get accelerate(): number {
    return this.state.throttle;
  }

  get brake(): number {
    return this.state.brake;
  }

  get steer(): number {
    return this.state.steer;
  }

  get handbrake(): boolean {
    return this.state.handbrake;
  }

  get lookBack(): boolean {
    return this.state.lookBack;
  }

  get look_back(): boolean {
    return this.state.lookBack;
  }

  get reset(): boolean {
    return this.state.reset;
  }

  get pause(): boolean {
    return this.state.pause;
  }

  get resetPressed(): boolean {
    return this.state.resetPressed;
  }

  get reset_pressed(): boolean {
    return this.state.reset_pressed;
  }

  get pausePressed(): boolean {
    return this.state.pausePressed;
  }

  get pause_pressed(): boolean {
    return this.state.pause_pressed;
  }

  // Test/virtual-keyboard entry point: press or release one `e.code`.
  // Refreshes the table eagerly (within the same call, faster than one
  // STEP_DT) and ignores repeats of an already-held code, mirroring the
  // `e.repeat` guard in the window keydown handler.
  setKey(code: string, down: boolean): void {
    if (typeof code !== "string" || code === "") {
      return;
    }
    if (down) {
      if (this.keys.has(code)) {
        return;
      }
      this.keys.add(code);
    } else {
      if (!this.keys.delete(code)) {
        return;
      }
    }
    this.poll();
  }

  // Swap the gamepad list reader (virtual pads under test); null
  // restores the live default.
  setGamepadOverride(source: GamepadSource | null): void {
    this.source = source ?? getDefaultGamepadSource();
  }

  // Listen for real keyboard on `window`. Safe no-op where no window
  // exists (Node/vitest); idempotent while attached.
  attach(): void {
    if (this.keyDownHandler !== null) {
      return;
    }
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
      return;
    }
    this.keyDownHandler = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return;
      }
      this.setKey(event.code, true);
    };
    this.keyUpHandler = (event: KeyboardEvent): void => {
      this.setKey(event.code, false);
    };
    window.addEventListener("keydown", this.keyDownHandler);
    window.addEventListener("keyup", this.keyUpHandler);
  }

  // Detach the window listeners added by `attach()`.
  dispose(): void {
    if (
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      if (this.keyDownHandler !== null) {
        window.removeEventListener("keydown", this.keyDownHandler);
      }
      if (this.keyUpHandler !== null) {
        window.removeEventListener("keyup", this.keyUpHandler);
      }
    }
    this.keyDownHandler = null;
    this.keyUpHandler = null;
  }

  // Single fixed-step entry point: merge keyboard plus the first live
  // gamepad into the owned state. Continuous fields take the keyboard-or
  // pad max (`throttle`/`brake`) and the deadzoned stick plus digital
  // right-minus-left (`steer`); held flags OR both sources; edge latches
  // fire only on the up-to-down transition and a pending unread `true`
  // is never cleared by a later poll (only a read consumes it). Never
  // throws: a missing gamepad or vehicle leaves the table zeroed.
  poll(): void {
    const pad = readPad(this.source);
    const keys = this.keys;
    const keyThrottle = keys.has(CODE_THROTTLE) || keys.has(CODE_THROTTLE_ALT);
    const keyBrake = keys.has(CODE_BRAKE) || keys.has(CODE_BRAKE_ALT);
    const keyLeft = keys.has(CODE_STEER_LEFT) || keys.has(CODE_STEER_LEFT_ALT);
    const keyRight = keys.has(CODE_STEER_RIGHT) || keys.has(CODE_STEER_RIGHT_ALT);
    const keyHandbrake = keys.has(CODE_HANDBRAKE);
    const keyLookBack = keys.has(CODE_LOOK_BACK);
    const keyReset = keys.has(CODE_RESET);
    const keyPause = keys.has(CODE_PAUSE);

    const stick = applyDeadzone(padAxisValue(pad, PAD_AXIS_STEER));
    const padThrottle = padTriggerValue(pad, PAD_THROTTLE_TRIGGER);
    const padBrake = padTriggerValue(pad, PAD_BRAKE_TRIGGER);
    const padLeft = padButtonDown(pad, PAD_STEER_LEFT);
    const padRight = padButtonDown(pad, PAD_STEER_RIGHT);
    const padHandbrake = padButtonDown(pad, PAD_HANDBRAKE);
    const padLookBack = padButtonDown(pad, PAD_LOOK_BACK);
    const padReset =
      padButtonDown(pad, PAD_RESET_LEFT) || padButtonDown(pad, PAD_RESET_RIGHT);
    const padPause = padButtonDown(pad, PAD_PAUSE);

    const digitalLeft = keyLeft || padLeft ? 1 : 0;
    const digitalRight = keyRight || padRight ? 1 : 0;

    this.state.throttle = Math.max(keyThrottle ? 1 : 0, padThrottle);
    this.state.brake = Math.max(keyBrake ? 1 : 0, padBrake);
    this.state.steer = clamp(stick + digitalRight - digitalLeft, -1, 1);
    this.state.handbrake = keyHandbrake || padHandbrake;
    this.state.lookBack = keyLookBack || padLookBack;
    const resetDown = keyReset || padReset;
    const pauseDown = keyPause || padPause;
    this.state.reset = resetDown;
    this.state.pause = pauseDown;
    if (resetDown && !this.prevResetDown) {
      this.state.resetPressed = true;
    }
    this.prevResetDown = resetDown;
    if (pauseDown && !this.prevPauseDown) {
      this.state.pausePressed = true;
    }
    this.prevPauseDown = pauseDown;
  }
}

// Factory entry point (injectable for tests that need isolation).
export function createPlayerInput(options?: PlayerInputOptions): PlayerInput {
  return new PlayerInput(options);
}

// v1 snake_case alias (same reference).
export const create_player_input = createPlayerInput;

// Shared poller singleton: the table the fixed step owns.
export const input = new PlayerInput();
