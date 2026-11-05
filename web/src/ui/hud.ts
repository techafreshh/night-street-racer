// DOM-only HUD sink ported from scripts/ui/hud.gd (pure display sink).
// Zero-dependency display module: only race/timetrial is imported for
// clock formatting (no WebGL renderer, no physics engine, no simulation). All state is
// pushed in via setters or update(); every DOM touch is guarded so the
// fixed step never breaks when nodes or the race are absent.

import {
  formatDelta,
  formatTime,
  format_delta,
  format_time,
} from "../race/timetrial";

export { formatDelta, formatTime, format_delta, format_time };

export const DRIFT_FADE_TIME = 1.5;
export const drift_fade_time = DRIFT_FADE_TIME;

// Minimal structural DOM surface so vitest can inject a stub document
// (core.test.ts stub-container idiom) without a real browser.
export type HudNodeLike = {
  textContent: string | null;
  hidden: boolean;
  style: { display: string; opacity: string };
};

export type HudDocumentLike = {
  getElementById: (id: string) => HudNodeLike | null;
  createElement?: (tag: string) => HudNodeLike;
  body?: { appendChild: (node: unknown) => void } | null;
};

export type HudVehicleSample = {
  speedMs: number;
  currentGear: number;
};

export type HudRaceSnapshot = {
  pos: number;
  total: number;
  lap: number;
  laps: number;
  raceTime: number;
  best?: number | null;
  driftScore?: number | null;
  driftTotal?: number | null;
};

export type HudSnapshot = {
  vehicle?: HudVehicleSample | null;
  race?: HudRaceSnapshot | null;
};

const IDS = [
  "hud",
  "hud-speed",
  "hud-gear",
  "hud-lap",
  "hud-position",
  "hud-timer",
  "hud-delta",
  "hud-drift",
] as const;

let hudDoc: HudDocumentLike | null = null;
let driftAge = 0;
let driftShown = 0;
let driftVisible = false;

function globalDoc(): HudDocumentLike | null {
  try {
    const doc = (globalThis as unknown as { document?: unknown }).document;
    if (doc !== undefined && doc !== null && typeof doc === "object") {
      return doc as HudDocumentLike;
    }
  } catch {
    // No DOM available (headless probe without document).
  }
  return null;
}

function asNode(value: unknown): HudNodeLike | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object") {
    return null;
  }
  const node = value as Partial<HudNodeLike>;
  if (typeof node.textContent === "undefined" && typeof node.hidden === "undefined") {
    return null;
  }
  return value as HudNodeLike;
}

function getNode(id: string): HudNodeLike | null {
  try {
    const doc = hudDoc ?? globalDoc();
    if (doc === null) {
      return null;
    }
    return asNode(doc.getElementById(id));
  } catch {
    return null;
  }
}

function setText(id: string, text: string): void {
  try {
    const node = getNode(id);
    if (node === null) {
      return;
    }
    node.textContent = text;
  } catch {
    // Display sinks never throw.
  }
}

// Speed in m/s; HUD shows integer km/h (hud.gd set_speed idiom).
export function speedKmhFor(speedMs: number): number {
  const value = Number.isFinite(speedMs) ? Math.abs(speedMs) : 0;
  return Math.round(value * 3.6);
}

// v1 snake_case alias (same reference).
export const speed_kmh_for = speedKmhFor;

// Gear text: "R" while reversing, "N" near standstill, else 1-5.
export function gearTextFor(speedMs: number, currentGear: number): string {
  const speed = Number.isFinite(speedMs) ? speedMs : 0;
  if (speed < -0.5) {
    return "R";
  }
  if (Math.abs(speed) < 0.5) {
    return "N";
  }
  const gear = Number.isFinite(currentGear) ? Math.trunc(currentGear) : 1;
  return String(Math.min(5, Math.max(1, gear)));
}

// v1 snake_case alias (same reference).
export const gear_text_for = gearTextFor;

// Exact "pos/total" standing readout.
export function positionTextFor(pos: number, total: number): string {
  const p = Number.isFinite(pos) ? Math.max(1, Math.trunc(pos)) : 1;
  const t = Number.isFinite(total) ? Math.max(1, Math.trunc(total)) : 1;
  return `${p}/${t}`;
}

// v1 snake_case alias (same reference).
export const position_text_for = positionTextFor;

// Exact "lap/laps" readout.
export function lapTextFor(lap: number, laps: number): string {
  const l = Number.isFinite(lap) ? Math.max(1, Math.trunc(lap)) : 1;
  const t = Number.isFinite(laps) ? Math.max(1, Math.trunc(laps)) : 1;
  return `${l}/${t}`;
}

// v1 snake_case alias (same reference).
export const lap_text_for = lapTextFor;

// Ensure the overlay nodes exist; safe to call before WASM init so
// probes see #hud* nodes on boot. Never throws.
export function ensureHud(doc?: HudDocumentLike | Document | null): HudNodeLike | null {
  try {
    const candidate =
      (doc as unknown as HudDocumentLike | null | undefined) ?? globalDoc();
    if (candidate !== null && candidate !== undefined) {
      hudDoc = candidate;
    }
    const active = hudDoc ?? globalDoc();
    if (active === null) {
      return null;
    }
    hudDoc = active;
    const existing = asNode(active.getElementById("hud"));
    if (existing !== null) {
      return existing;
    }
    if (typeof active.createElement !== "function") {
      return null;
    }
    const hud = asNode(active.createElement("div"));
    if (hud === null) {
      return null;
    }
    try {
      (hud as unknown as { id: string }).id = "hud";
      hud.hidden = true;
      hud.style.display = "none";
    } catch {
      // Best effort on stub nodes.
    }
    for (const id of IDS.slice(1)) {
      try {
        const child = asNode(active.createElement("div"));
        if (child === null) {
          continue;
        }
        (child as unknown as { id: string }).id = id;
        try {
          (hud as unknown as { appendChild: (n: unknown) => void }).appendChild(child);
        } catch {
          // Stub nodes without appendChild still satisfy getElementById.
        }
      } catch {
        // One missing child never blocks the rest.
      }
    }
    try {
      active.body?.appendChild(hud);
    } catch {
      // Detached overlay still resolves via getElementById on real DOM.
    }
    return hud;
  } catch {
    return null;
  }
}

// v1 snake_case alias.
export const ensure_hud = ensureHud;

export function setSpeed(speedMs: number): void {
  setText("hud-speed", `${speedKmhFor(speedMs)} km/h`);
}

export const set_speed = setSpeed;

export function setGear(gear: number, reversing = false): void {
  try {
    const speed = reversing ? -1 : 1;
    setText("hud-gear", gearTextFor(speed, gear));
  } catch {
    // Display sinks never throw.
  }
}

export const set_gear = setGear;

export function setLapPosition(pos: number, total: number, lap: number, laps: number): void {
  setText("hud-position", positionTextFor(pos, total));
  setText("hud-lap", lapTextFor(lap, laps));
}

export const set_lap_position = setLapPosition;

export function setRaceTime(seconds: number): void {
  setText("hud-timer", formatTime(seconds));
}

export const set_race_time = setRaceTime;

export function setDelta(d: number): void {
  setText("hud-delta", formatDelta(d));
  try {
    const node = getNode("hud-delta");
    if (node !== null) {
      node.hidden = false;
      node.style.display = "";
    }
  } catch {
    // Display sinks never throw.
  }
}

export const set_delta = setDelta;

export function clearDelta(): void {
  setText("hud-delta", "--:--.---");
  try {
    const node = getNode("hud-delta");
    if (node !== null) {
      node.hidden = true;
      node.style.display = "none";
    }
  } catch {
    // Display sinks never throw.
  }
}

export const clear_delta = clearDelta;

export function showDrift(score: number): void {
  try {
    const whole = Number.isFinite(score) ? Math.max(0, Math.trunc(score)) : 0;
    setText("hud-drift", `DRIFT +${whole}`);
    driftShown = whole;
    driftAge = 0;
    driftVisible = true;
    const node = getNode("hud-drift");
    if (node !== null) {
      node.hidden = false;
      node.style.display = "";
      node.style.opacity = "1";
    }
  } catch {
    // Display sinks never throw.
  }
}

export const show_drift = showDrift;

// Advance the 1.5 s drift fade (Godot DRIFT_FADE_TIME); hides on expiry.
export function updateHud(dt: number): void {
  try {
    if (!driftVisible) {
      return;
    }
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    driftAge += step;
    const left = Math.min(1, Math.max(0, 1 - driftAge / DRIFT_FADE_TIME));
    const node = getNode("hud-drift");
    if (node !== null) {
      node.style.opacity = String(left);
      if (left <= 0) {
        node.hidden = true;
        node.style.display = "none";
      }
    }
    if (left <= 0) {
      driftVisible = false;
    }
  } catch {
    // Display sinks never throw.
  }
}

export const update_hud = updateHud;

function setHudVisible(visible: boolean): void {
  try {
    const node = getNode("hud");
    if (node === null) {
      return;
    }
    node.hidden = !visible;
    node.style.display = visible ? "" : "none";
  } catch {
    // Display sinks never throw.
  }
}

// Live binder: pushes a duck-typed snapshot into the overlay. A missing
// race hides #hud and returns; vehicle-only data never unhides it.
export function update(snapshot: HudSnapshot | null | undefined, dt?: number): void {
  try {
    const race = snapshot?.race ?? null;
    if (race === null || race === undefined) {
      setHudVisible(false);
      if (typeof dt === "number") {
        updateHud(dt);
      }
      return;
    }
    setHudVisible(true);
    const vehicle = snapshot?.vehicle ?? null;
    const speedMs = vehicle !== null && vehicle !== undefined ? vehicle.speedMs : 0;
    const gear = vehicle !== null && vehicle !== undefined ? vehicle.currentGear : 1;
    setSpeed(speedMs);
    setText("hud-gear", gearTextFor(speedMs, gear));
    setLapPosition(race.pos, race.total, race.lap, race.laps);
    setRaceTime(race.raceTime);
    if (race.best !== null && race.best !== undefined && Number.isFinite(race.best)) {
      setDelta(race.raceTime - (race.best as number));
    } else {
      clearDelta();
    }
    const driftRaw = race.driftTotal ?? race.driftScore ?? null;
    if (typeof driftRaw === "number" && Number.isFinite(driftRaw)) {
      const whole = Math.max(0, Math.trunc(driftRaw));
      if (whole > driftShown) {
        showDrift(whole);
      } else if (whole < driftShown && !driftVisible) {
        driftShown = whole;
      }
    }
    updateHud(typeof dt === "number" ? dt : 0);
  } catch {
    // The HUD never breaks the fixed step.
  }
}

// Defensive subscribe: links known race signals only when the provider
// actually offers on(); a missing emitter is silently skipped. Returns
// an off closure (hud.gd _wire_race_signals idiom).
export function attachRace(emitter: unknown): () => void {
  try {
    if (emitter === null || emitter === undefined) {
      return () => {};
    }
    const provider = emitter as {
      on?: unknown;
      off?: unknown;
    };
    if (typeof provider.on !== "function") {
      return () => {};
    }
    const on = provider.on as (event: string, handler: () => void) => void;
    const off =
      typeof provider.off === "function"
        ? (provider.off as (event: string, handler: () => void) => void)
        : null;
    const handlers: Array<[string, () => void]> = [];
    const noop = (): void => {};
    for (const event of ["onRaceStateChanged", "onCheckpoint"]) {
      try {
        const handler: () => void = () => {
          noop();
        };
        on.call(emitter, event, handler);
        handlers.push([event, handler]);
      } catch {
        // One failing signal never blocks the rest.
      }
    }
    return () => {
      if (off === null) {
        return;
      }
      for (const [event, handler] of handlers) {
        try {
          off.call(emitter, event, handler);
        } catch {
          // Detach is best effort.
        }
      }
    };
  } catch {
    return () => {};
  }
}

// v1 snake_case alias (same reference).
export const attach_race = attachRace;

export type HudNamespace = {
  speedKmhFor: typeof speedKmhFor;
  speed_kmh_for: typeof speedKmhFor;
  gearTextFor: typeof gearTextFor;
  gear_text_for: typeof gearTextFor;
  positionTextFor: typeof positionTextFor;
  position_text_for: typeof positionTextFor;
  lapTextFor: typeof lapTextFor;
  lap_text_for: typeof lapTextFor;
  formatTime: typeof formatTime;
  format_time: typeof formatTime;
  formatDelta: typeof formatDelta;
  format_delta: typeof formatDelta;
  ensureHud: typeof ensureHud;
  ensure_hud: typeof ensureHud;
  setSpeed: typeof setSpeed;
  set_speed: typeof setSpeed;
  setGear: typeof setGear;
  set_gear: typeof setGear;
  setLapPosition: typeof setLapPosition;
  set_lap_position: typeof setLapPosition;
  setRaceTime: typeof setRaceTime;
  set_race_time: typeof setRaceTime;
  setDelta: typeof setDelta;
  set_delta: typeof setDelta;
  clearDelta: typeof clearDelta;
  clear_delta: typeof clearDelta;
  showDrift: typeof showDrift;
  show_drift: typeof showDrift;
  updateHud: typeof updateHud;
  update_hud: typeof updateHud;
  update: typeof update;
  attachRace: typeof attachRace;
  attach_race: typeof attachRace;
  DRIFT_FADE_TIME: number;
};
