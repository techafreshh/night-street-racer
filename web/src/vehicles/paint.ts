// Shared tuner paint palette (scripts/vehicles/car_paint.gd COLORS port).
// Four sRGB hex variants transcribed from the Godot COLORS block so the
// garage swatches and the canvas turntable tint from one source. Zero
// imports so the module loads under Node/vitest. Never throws.

export const COLORS: string[] = [
  "#2659F2",
  "#F2661A",
  "#BFC2CC",
  "#1A9933",
];

export const COLOR_COUNT = 4;

// Wrap any index into the palette with posmod (car_paint.gd idiom):
// negatives and overflows cycle instead of throwing. Non-finite input
// falls back to slot 0. Never throws.
export function colorFor(index: number): string {
  try {
    const slot = Number.isFinite(index) ? Math.trunc(index) : 0;
    return COLORS[((slot % COLORS.length) + COLORS.length) % COLORS.length];
  } catch {
    return COLORS[0];
  }
}

// Hex CSS string for a palette slot (same wrap rule as colorFor).
export function colorCss(index: number): string {
  return colorFor(index);
}

// v1 snake_case aliases (same references).
export const color_for = colorFor;
export const color_css = colorCss;
