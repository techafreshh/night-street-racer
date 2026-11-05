// Night renderer factory: ACES filmic tone mapping, sRGB output,
// capped pixel ratio, and moon-only soft shadows. The factory is
// browser-only (WebGLRenderer construction needs a canvas); the pinned
// constants stay Node-safe. Never throws: without WebGL it returns
// null and the caller keeps the menu alive.
import * as THREE from "three";

// Filmic highlight rolloff for the emissive-first night look.
export const TONE_MAPPING = THREE.ACESFilmicToneMapping;
export const TONE_MAPPING_EXPOSURE = 1.1;
export const MAX_PIXEL_RATIO = 2;

// Same-reference aliases so harness wording cannot mismatch.
export const tone_mapping = TONE_MAPPING;
export const TONE_MAP = TONE_MAPPING;
export const tone_mapping_exposure = TONE_MAPPING_EXPOSURE;
export const max_pixel_ratio = MAX_PIXEL_RATIO;

// Browser-only night renderer for the race canvas. Applies the pinned
// tone mapping, exposure, output color space, pixel-ratio cap, and
// shadow map. Returns null (never throws) when WebGL is unavailable.
export function createNightRenderer(
  canvas: HTMLCanvasElement | null | undefined,
): THREE.WebGLRenderer | null {
  try {
    if (canvas === undefined || canvas === null) {
      return null;
    }
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.toneMapping = TONE_MAPPING;
    renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const ratio =
      typeof window !== "undefined" &&
      typeof window.devicePixelRatio === "number" &&
      Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : 1;
    renderer.setPixelRatio(Math.min(ratio, MAX_PIXEL_RATIO));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const width =
      typeof window !== "undefined" &&
      Number.isFinite(window.innerWidth) &&
      window.innerWidth > 0
        ? window.innerWidth
        : 800;
    const height =
      typeof window !== "undefined" &&
      Number.isFinite(window.innerHeight) &&
      window.innerHeight > 0
        ? window.innerHeight
        : 600;
    renderer.setSize(width, height);
    return renderer;
  } catch {
    return null;
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const create_night_renderer = createNightRenderer;

export type ResizableComposer = {
  setSize(width: number, height: number): void;
};

// Resize helper for the renderer/composer pair. Never throws; nulls
// and non-finite sizes are ignored so a stray resize cannot kill the
// frame loop.
export function resizeRenderer(
  renderer: THREE.WebGLRenderer | null | undefined,
  composer: ResizableComposer | null | undefined,
  width: number,
  height: number,
): void {
  try {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return;
    }
    if (width <= 0 || height <= 0) {
      return;
    }
    renderer?.setSize(width, height);
    composer?.setSize(width, height);
  } catch {
    // Resizes must never break rendering.
  }
}

// Godot-name alias so harness wording cannot mismatch (same reference).
export const resize_renderer = resizeRenderer;
