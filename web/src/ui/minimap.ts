// 2D minimap sink ported from scripts/race/race.gd (_normalize_minimap)
// and scripts/ui/hud.gd (MAP_SIZE / PLAYER_DOT / CHECKPOINT_DOT).
// Zero-dependency pure-math + canvas-display module: no WebGL renderer,
// no physics engine, no simulation. All state is pushed in via
// updateMinimap(); every DOM/canvas touch is guarded so the fixed step
// never breaks when nodes or the race are absent. North-up: -Z reads at
// the canvas top via the direct (x, z) -> (px, py) map (no axis flip).

export const MAP_SIZE = 200;
export const map_size = MAP_SIZE;

// Half-extent in metres (race.gd _normalize_minimap divisor 280,
// COORD_LIMIT in web/src/data/events.ts); (0, 0) projects to (100, 100).
export const HALF_EXTENT = 140;
export const half_extent = HALF_EXTENT;

// Dot sizes in px (hud.gd CHECKPOINT_DOT 4, PLAYER_DOT 6).
export const GATE_DOT = 4;
export const gate_dot = GATE_DOT;
export const PLAYER_DOT = 6;
export const player_dot = PLAYER_DOT;
export const RIVAL_DOT = 4;
export const rival_dot = RIVAL_DOT;

// Redraw throttle: the module redraws at most every 0.1 s of accumulated
// fixed-step time (10 Hz); extra updateMinimap calls are cheap no-ops.
export const UPDATE_INTERVAL = 0.1;
export const update_interval = UPDATE_INTERVAL;

// Canvas palette: dark translucent face, light route polyline, gold gate
// dots (v1 Color(1.0, 0.85, 0.2)), white player dot, red rival dots.
const FACE = "rgba(8, 10, 18, 0.72)";
const ROUTE = "#dfe3f2";
const GATE = "#ffd933";
const PLAYER = "#ffffff";
const RIVAL = "#ff4d5e";

// Minimal structural canvas surface so vitest injects a stub canvas with
// no browser (hud.ts HudDocumentLike idiom). A real HTMLCanvasElement +
// CanvasRenderingContext2D satisfies these structurally.
export type MinimapContextLike = {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  clearRect: (x: number, y: number, w: number, h: number) => void;
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  closePath: () => void;
  stroke: () => void;
  fillRect: (x: number, y: number, w: number, h: number) => void;
};

export type MinimapCanvasLike = {
  width: number;
  height: number;
  getContext?: (kind: string) => MinimapContextLike | null;
};

export type MinimapDocumentLike = {
  getElementById: (id: string) => unknown;
  createElement?: (tag: string) => unknown;
  body?: { appendChild: (node: unknown) => void } | null;
};

// Anything with finite x/z reads as a map point (manager.ts asPoint
// idiom); y is carried for vehicle samples but ignored by projection.
export type MinimapPointLike = {
  x: number;
  z: number;
  y?: number;
};

export type MinimapSnapshot = {
  player?: unknown;
  rivals?: unknown;
  gates?: unknown;
};

let minimapDoc: MinimapDocumentLike | null = null;
let clock = 0;

function globalDoc(): MinimapDocumentLike | null {
  try {
    const doc = (globalThis as unknown as { document?: unknown }).document;
    if (doc !== undefined && doc !== null && typeof doc === "object") {
      return doc as MinimapDocumentLike;
    }
  } catch {
    // No DOM available (headless probe without document).
  }
  return null;
}

function asCanvas(value: unknown): MinimapCanvasLike | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object") {
    return null;
  }
  const node = value as Partial<MinimapCanvasLike>;
  if (typeof node.width !== "number" || typeof node.height !== "number") {
    return null;
  }
  return value as MinimapCanvasLike;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Port of race.gd _normalize_minimap: XZ over +/-140 m into 0..1,
// clamped so off-track samples pin to the face edge. Never throws.
export function normalizeMinimap(
  x: unknown,
  z: unknown,
): { x: number; y: number } {
  try {
    const nx = (finiteOrZero(x) + HALF_EXTENT) / (2 * HALF_EXTENT);
    const ny = (finiteOrZero(z) + HALF_EXTENT) / (2 * HALF_EXTENT);
    return { x: clamp01(nx), y: clamp01(ny) };
  } catch {
    return { x: 0.5, y: 0.5 };
  }
}

// v1 snake_case alias (same reference).
export const normalize_minimap = normalizeMinimap;

// Normalized XZ into canvas pixels: (0, 0) -> (100, 100), clamped to the
// 0..200 face. North-up: -Z maps to the canvas top (small py).
export function projectToMap(
  x: unknown,
  z: unknown,
): { px: number; py: number } {
  try {
    const n = normalizeMinimap(x, z);
    const edge = (v: number): number =>
      Math.min(MAP_SIZE, Math.max(0, v * MAP_SIZE));
    return { px: edge(n.x), py: edge(n.y) };
  } catch {
    return { px: MAP_SIZE / 2, py: MAP_SIZE / 2 };
  }
}

// v1 snake_case alias (same reference).
export const project_to_map = projectToMap;

// Defensive point coercion (race/manager.ts normalizeInput idiom): bad
// rival/gate entries are skipped, never thrown.
function asMapPoint(value: unknown): MinimapPointLike | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.x !== "number" || !Number.isFinite(record.x)) {
    return undefined;
  }
  if (typeof record.z !== "number" || !Number.isFinite(record.z)) {
    return undefined;
  }
  return { x: record.x, z: record.z };
}

function toPointList(value: unknown): MinimapPointLike[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: MinimapPointLike[] = [];
  for (const entry of value) {
    const point = asMapPoint(entry);
    if (point !== undefined) {
      out.push(point);
    }
  }
  return out;
}

// Ensure the #minimap canvas exists with width = height = 200; safe to
// call before first paint so probes see the node on first paint even if
// JS init lags (the static index.html node is the primary guarantee,
// this is the JS fallback). Never throws.
export function ensureMinimap(
  doc?: MinimapDocumentLike | Document | null,
): MinimapCanvasLike | null {
  try {
    const candidate =
      (doc as unknown as MinimapDocumentLike | null | undefined) ??
      globalDoc();
    if (candidate !== null && candidate !== undefined) {
      minimapDoc = candidate;
    }
    const active = minimapDoc ?? globalDoc();
    if (active === null) {
      return null;
    }
    minimapDoc = active;
    const existing = asCanvas(active.getElementById("minimap"));
    if (existing !== null) {
      try {
        existing.width = MAP_SIZE;
        existing.height = MAP_SIZE;
      } catch {
        // Best effort on stub nodes.
      }
      return existing;
    }
    if (typeof active.createElement !== "function") {
      return null;
    }
    const created = asCanvas(active.createElement("canvas"));
    if (created === null) {
      return null;
    }
    try {
      (created as unknown as { id: string }).id = "minimap";
      created.width = MAP_SIZE;
      created.height = MAP_SIZE;
    } catch {
      // Best effort on stub nodes.
    }
    try {
      active.body?.appendChild(created);
    } catch {
      // Detached canvas still resolves via getElementById on real DOM.
    }
    return created;
  } catch {
    return null;
  }
}

// v1 snake_case alias (same reference).
export const ensure_minimap = ensureMinimap;

function dot(
  ctx: MinimapContextLike,
  px: number,
  py: number,
  size: number,
): void {
  try {
    ctx.fillRect(px - size / 2, py - size / 2, size, size);
  } catch {
    // Display sinks never throw.
  }
}

// Full redraw: clears the face, strokes the gate polyline closed for
// circuits, then fills gate dots, rival dots, and the player dot last
// (on top). Null canvas/snapshot and bad entries are skipped, never
// thrown, so the fixed step never breaks.
export function drawMinimap(
  canvas: unknown,
  snapshot?: MinimapSnapshot | null,
): void {
  try {
    const node = asCanvas(canvas);
    if (node === null) {
      return;
    }
    if (typeof node.getContext !== "function") {
      return;
    }
    let ctx: MinimapContextLike | null = null;
    try {
      ctx = node.getContext.call(node, "2d");
    } catch {
      return;
    }
    if (ctx === null || ctx === undefined) {
      return;
    }
    try {
      ctx.fillStyle = FACE;
      ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    } catch {
      return;
    }
    const gates = toPointList(snapshot?.gates);
    if (gates.length >= 2) {
      try {
        ctx.strokeStyle = ROUTE;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < gates.length; i++) {
          const gate = gates[i] as MinimapPointLike;
          const p = projectToMap(gate.x, gate.z);
          if (i === 0) {
            ctx.moveTo(p.px, p.py);
          } else {
            ctx.lineTo(p.px, p.py);
          }
        }
        ctx.closePath();
        ctx.stroke();
      } catch {
        // A broken route stroke never blocks the dots.
      }
    }
    try {
      ctx.fillStyle = GATE;
      for (const gate of gates) {
        const p = projectToMap(gate.x, gate.z);
        dot(ctx, p.px, p.py, GATE_DOT);
      }
    } catch {
      // Display sinks never throw.
    }
    try {
      ctx.fillStyle = RIVAL;
      for (const rival of toPointList(snapshot?.rivals)) {
        const p = projectToMap(rival.x, rival.z);
        dot(ctx, p.px, p.py, RIVAL_DOT);
      }
    } catch {
      // Display sinks never throw.
    }
    try {
      const player = asMapPoint(snapshot?.player);
      if (player !== undefined) {
        const p = projectToMap(player.x, player.z);
        ctx.fillStyle = PLAYER;
        dot(ctx, p.px, p.py, PLAYER_DOT);
      }
    } catch {
      // Display sinks never throw.
    }
  } catch {
    // The minimap never breaks the fixed step.
  }
}

// v1 snake_case alias (same reference).
export const draw_minimap = drawMinimap;

function findCanvas(): MinimapCanvasLike | null {
  try {
    const active = minimapDoc ?? globalDoc();
    if (active === null) {
      return null;
    }
    return asCanvas(active.getElementById("minimap"));
  } catch {
    return null;
  }
}

// 10 Hz gate: accumulates fixed-step dt and redraws only once the
// accumulator reaches UPDATE_INTERVAL (0.1 s). Returns whether a redraw
// happened. Non-finite/non-positive dt is ignored without drawing.
export function updateMinimap(
  dt: number,
  snapshot?: MinimapSnapshot | null,
): boolean {
  try {
    if (!Number.isFinite(dt) || dt <= 0) {
      return false;
    }
    clock += dt;
    if (clock < UPDATE_INTERVAL) {
      return false;
    }
    clock = 0;
    const canvas = findCanvas();
    if (canvas === null) {
      return false;
    }
    drawMinimap(canvas, snapshot ?? null);
    return true;
  } catch {
    return false;
  }
}

// v1 snake_case alias (same reference).
export const update_minimap = updateMinimap;

// Test hook: drops the throttle accumulator so throttle tests start cold.
export function resetMinimapClock(): void {
  clock = 0;
}

// v1 snake_case alias (same reference).
export const reset_minimap_clock = resetMinimapClock;

export type MinimapNamespace = {
  normalizeMinimap: typeof normalizeMinimap;
  normalize_minimap: typeof normalizeMinimap;
  projectToMap: typeof projectToMap;
  project_to_map: typeof projectToMap;
  ensureMinimap: typeof ensureMinimap;
  ensure_minimap: typeof ensureMinimap;
  drawMinimap: typeof drawMinimap;
  draw_minimap: typeof drawMinimap;
  updateMinimap: typeof updateMinimap;
  update_minimap: typeof updateMinimap;
  resetMinimapClock: typeof resetMinimapClock;
  reset_minimap_clock: typeof resetMinimapClock;
  MAP_SIZE: number;
  map_size: number;
  HALF_EXTENT: number;
  half_extent: number;
  GATE_DOT: number;
  gate_dot: number;
  PLAYER_DOT: number;
  player_dot: number;
  RIVAL_DOT: number;
  rival_dot: number;
  UPDATE_INTERVAL: number;
  update_interval: number;
};
