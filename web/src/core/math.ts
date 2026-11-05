// Pure math helpers (GameState typed-API-with-owner-comment idiom).
// Total functions with no three.js or DOM imports: safe to call from the
// fixed-step accumulator, tests, and render code alike.

const TAU = Math.PI * 2;

// Typed clamp: constrain value to the closed [min, max] range.
export function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

// Typed lerp: linear blend from a to b; t is unclamped by design.
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Typed angle wrap: normalize radians to the [-PI, PI] range.
export function wrapAngle(radians: number): number {
  let wrapped = radians % TAU;
  if (wrapped > Math.PI) {
    wrapped -= TAU;
  } else if (wrapped < -Math.PI) {
    wrapped += TAU;
  }
  return wrapped;
}
