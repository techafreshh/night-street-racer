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
