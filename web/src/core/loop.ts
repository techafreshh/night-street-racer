// 60 Hz fixed-step accumulator skeleton.
// Driven by main.ts via start()/stop(); the step callback runs at a
// fixed 1/60 s regardless of rAF jitter, leftover time is clamped so
// a backgrounded tab cannot spiral.

export const STEP_HZ = 60;
export const STEP_DT = 1 / STEP_HZ;
const MAX_FRAME_DT = 0.25;

export interface LoopHandle {
  stop(): void;
}

export function start(step: (dt: number) => void): LoopHandle {
  let accumulator = 0;
  let last = performance.now();
  let raf = 0;
  let stopped = false;

  const frame = (now: number): void => {
    if (stopped) {
      return;
    }
    let elapsed = (now - last) / 1000;
    last = now;
    if (elapsed > MAX_FRAME_DT) {
      elapsed = MAX_FRAME_DT;
    }
    accumulator += elapsed;
    while (accumulator >= STEP_DT) {
      step(STEP_DT);
      accumulator -= STEP_DT;
    }
    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);
  return {
    stop(): void {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}
