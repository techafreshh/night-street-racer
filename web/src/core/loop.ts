// 60 Hz fixed-step accumulator clock (RaceEventManager STEP idiom).
// requestAnimationFrame measures wall time while the STEP_DT accumulator
// is the authoritative stepper: each frame drains zero or more fixed
// steps and leftover time is clamped so a backgrounded tab cannot spiral.
// Pause gates only the accumulator drain (pause.gd PROCESS_MODE_ALWAYS
// idiom): the rAF loop and DOM stay alive and the frame clock is reset
// every frame so resume never jumps. Window-free by design so Node/vitest
// can drive it with stubbed rAF.

export const STEP_HZ = 60;
export const STEP_DT = 1 / STEP_HZ;
export const MAX_FRAME_DT = 0.25;

// Probe-readable FPS meter (issue #229): rAF-timestamp EMA with no DOM,
// so vitest drives it with synthetic timestamps and the running service
// samples it every renderFrame. Smoothing matches an ~10-frame window;
// first sample only arms the clock, oversized gaps (background tabs)
// are ignored like the MAX_FRAME_DT clamp in start().
export function createFpsMeter(smoothing = 0.1): {
  sample: (now: number) => void;
  readonly fps: number;
  reset: () => void;
} {
  const alpha =
    typeof smoothing === "number" &&
    Number.isFinite(smoothing) &&
    smoothing > 0 &&
    smoothing <= 1
      ? smoothing
      : 0.1;
  let fps = 0;
  let last: number | null = null;
  return {
    sample(now: number): void {
      try {
        if (typeof now !== "number" || !Number.isFinite(now)) {
          return;
        }
        if (last === null) {
          last = now;
          return;
        }
        const dt = (now - last) / 1000;
        last = now;
        if (!(dt > 0) || dt > MAX_FRAME_DT) {
          return;
        }
        const instant = 1 / dt;
        fps = fps === 0 ? instant : fps + alpha * (instant - fps);
      } catch {
        // The meter must never throw.
      }
    },
    get fps(): number {
      return fps;
    },
    reset(): void {
      fps = 0;
      last = null;
    },
  };
}

export interface LoopHandle {
  stop(): void;
  setPaused(paused: boolean): void;
  isPaused(): boolean;
}

export function start(step: (dt: number) => void): LoopHandle {
  let accumulator = 0;
  let last = performance.now();
  let raf = 0;
  let stopped = false;
  let paused = false;

  const frame = (now: number): void => {
    if (stopped) {
      return;
    }
    let elapsed = (now - last) / 1000;
    last = now;
    if (elapsed > MAX_FRAME_DT) {
      elapsed = MAX_FRAME_DT;
    }
    if (paused) {
      accumulator = 0;
    } else {
      accumulator += elapsed;
      while (accumulator >= STEP_DT) {
        step(STEP_DT);
        accumulator -= STEP_DT;
      }
    }
    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);
  return {
    stop(): void {
      stopped = true;
      cancelAnimationFrame(raf);
    },
    setPaused(value: boolean): void {
      paused = value;
      if (paused) {
        accumulator = 0;
      }
    },
    isPaused(): boolean {
      return paused;
    },
  };
}
