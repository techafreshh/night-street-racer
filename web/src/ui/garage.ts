// Garage screen (scripts/ui/garage.gd port).
// Pure display sink in the hud.ts idiom: one .car-card section per catalog
// car with live tune stats, a small canvas turntable preview tinted from
// the shared paint palette, and the Progression.is_car_unlocked_with lock
// rule (sedan is always open, others only when in the gameState unlock
// cache). The four paint swatches are one shared row. Car picks persist
// through gameState.selectCar/selectColor plus a synchronous flush() so
// the choice survives a reload. Start arms the race manager on the
// selected event (harbor_sprint fallback) and routes to the race screen.
// Guarded; never throws, with no WebGL or physics imports.

import type { Router } from "../core/router";
import { getTune } from "../data/tunes";
import { LADDER, mappedCar } from "../game/progression";
import { getBest } from "../game/records";
import { gameState } from "../game/state";
import { manager } from "../race/manager";
import { COLOR_COUNT, colorCss } from "../vehicles/paint";
import { appendChild, menuButton, onPress, screenRoot, staticLine } from "./screens";

export { COLOR_COUNT };

// Catalog order mirrors GarageUI.CAR_IDS so probes read the same ids.
export const CAR_IDS = ["sedan", "coupe", "hatch", "awd"] as const;

// Disk-free car lock rule over the gameState snapshot (garage.gd
// is_car_unlocked_with idiom): sedan is always open, otherwise the car
// must sit in the unlocked-cars cache. Never throws.
export function isCarUnlockedWith(carId: string, unlocked: string[]): boolean {
  try {
    if (carId === "sedan") {
      return true;
    }
    if (!Array.isArray(unlocked)) {
      return false;
    }
    return unlocked.includes(carId);
  } catch {
    return false;
  }
}

// v1 snake_case alias (same reference).
export const is_car_unlocked_with = isCarUnlockedWith;

// Legacy name alias (same reference).
export const isCarUnlocked = isCarUnlockedWith;

// Requirement line for a locked car: "Win <event> to unlock" naming the
// first LADDER rung awarding that car (mappedCar), or the generic fallback
// when no rung awards it. Empty when the car is already open. The unlocked
// list defaults to the live gameState snapshot. Never throws.
export function unlockRequirementFor(carId: string, unlocked?: string[]): string {
  try {
    let list: string[] = [];
    if (Array.isArray(unlocked)) {
      list = unlocked;
    } else {
      try {
        list = gameState.unlockedCars ?? [];
      } catch {
        list = [];
      }
    }
    if (isCarUnlockedWith(carId, list)) {
      return "";
    }
    let event = "";
    try {
      for (const rung of LADDER) {
        if (mappedCar(rung) === carId) {
          event = rung;
          break;
        }
      }
    } catch {
      event = "";
    }
    if (event !== "") {
      return `Win ${event} to unlock`;
    }
    return "Win a race to unlock";
  } catch {
    return "Win a race to unlock";
  }
}

// v1 snake_case alias (same reference).
export const unlock_requirement_for = unlockRequirementFor;

// Stat line for a car card built from its tune (garage.gd _add_car_button
// mode_label stat-line idiom). Falls back to the bare car id when the
// tune is missing. Never throws.
export function statLabelFor(carId: string): string {
  try {
    const tune = getTune(carId);
    if (tune === undefined || tune === null) {
      return carId;
    }
    const torque = Math.trunc(tune.engine_torque);
    return `${torque} Nm · ${tune.tire_grip_front}/${tune.tire_grip_rear} grip · ${tune.drivetrain}`;
  } catch {
    return carId;
  }
}

// v1 snake_case alias (same reference).
export const stat_label_for = statLabelFor;

type ElementLike = Record<string, unknown>;

// Guarded element factory mirroring screens.ts createEl: the live (or
// stub) document when present, a minimal stub fallback otherwise. Never
// throws.
function createTag(tag: string): ElementLike {
  try {
    const doc = (globalThis as unknown as { document?: unknown }).document as
      | { createElement?: (tag: string) => unknown }
      | null
      | undefined;
    if (doc !== null && typeof doc === "object" && typeof doc.createElement === "function") {
      const node = doc.createElement(tag) as unknown;
      if (node !== null && typeof node === "object") {
        return node as ElementLike;
      }
    }
  } catch {
    // Fall through to the stub.
  }
  const listeners = new Map<string, Array<() => void>>();
  const el: ElementLike = {
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    disabled: false,
    hidden: false,
    style: {},
    children: [] as unknown[],
  };
  el["appendChild"] = (child: unknown): unknown => {
    try {
      (el["children"] as unknown[]).push(child);
    } catch {
      // Best effort on stub nodes.
    }
    return child;
  };
  el["addEventListener"] = (type: string, listener: () => void): void => {
    try {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    } catch {
      // Best effort on stub nodes.
    }
  };
  el["click"] = (): void => {
    try {
      for (const listener of [...(listeners.get("click") ?? [])]) {
        try {
          listener();
        } catch {
          // One failing listener never blocks the rest.
        }
      }
    } catch {
      // Display sinks never throw.
    }
  };
  return el;
}

function setProp(el: unknown, key: string, value: unknown): void {
  try {
    (el as ElementLike)[key] = value;
  } catch {
    // Display sinks never throw.
  }
}

type PreviewEntry = {
  canvas: ElementLike;
  carId: string;
};

let previewEntries: PreviewEntry[] = [];
let previewRaf: number | null = null;
let previewAngle = 0;

// Single tinted-silhouette frame on one preview canvas using the current
// paint slot. No-ops when the 2D context is absent. Never throws.
function drawPreview(entry: PreviewEntry): void {
  try {
    const canvas = entry.canvas as {
      getContext?: (kind: string) => unknown;
      width?: unknown;
      height?: unknown;
    };
    if (canvas === null || typeof canvas !== "object") {
      return;
    }
    if (typeof canvas.getContext !== "function") {
      return;
    }
    const ctx = canvas.getContext("2d") as
      | {
          clearRect?: (x: number, y: number, w: number, h: number) => void;
          save?: () => void;
          restore?: () => void;
          translate?: (x: number, y: number) => void;
          scale?: (x: number, y: number) => void;
          fillStyle?: string;
          fillRect?: (x: number, y: number, w: number, h: number) => void;
          beginPath?: () => void;
          arc?: (x: number, y: number, r: number, a: number, b: number) => void;
          fill?: () => void;
        }
      | null;
    if (ctx === null || typeof ctx !== "object") {
      return;
    }
    const width = typeof canvas.width === "number" && canvas.width > 0 ? canvas.width : 120;
    const height = typeof canvas.height === "number" && canvas.height > 0 ? canvas.height : 72;
    let paint = "#2659F2";
    try {
      paint = colorCss(gameState.getSelectedColor());
    } catch {
      // Fall back to the default slot.
    }
    try {
      ctx.clearRect?.(0, 0, width, height);
    } catch {
      // Best effort on stub contexts.
    }
    try {
      ctx.save?.();
      // Turntable squash: the silhouette narrows as it rotates.
      const squash = Math.abs(Math.cos(previewAngle)) * 0.7 + 0.3;
      ctx.translate?.(width / 2, height / 2);
      ctx.scale?.(squash, 1);
      const bodyW = width * 0.72;
      const bodyH = height * 0.34;
      ctx.fillStyle = paint;
      ctx.fillRect?.(-bodyW / 2, -bodyH / 2, bodyW, bodyH);
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect?.(-bodyW * 0.22, -bodyH / 2 - bodyH * 0.55, bodyW * 0.44, bodyH * 0.6);
      ctx.fillStyle = "#111117";
      const wheelY = bodyH / 2 + 2;
      for (const wheelX of [-bodyW * 0.3, bodyW * 0.3]) {
        try {
          ctx.beginPath?.();
          ctx.arc?.(wheelX, wheelY, 6, 0, Math.PI * 2);
          ctx.fill?.();
        } catch {
          // One bad wheel never blocks the frame.
        }
      }
      ctx.fillStyle = "#FFE9A3";
      ctx.fillRect?.(bodyW / 2 - 3, -bodyH / 4, 3, bodyH / 2);
      ctx.restore?.();
    } catch {
      // A partial frame never breaks the loop.
    }
  } catch {
    // Display sinks never throw.
  }
}

// Repaint every live preview once (static fallback when rAF is absent and
// immediate re-tint after a swatch press). Never throws.
function repaintPreviews(): void {
  try {
    for (const entry of [...previewEntries]) {
      drawPreview(entry);
    }
  } catch {
    // Display sinks never throw.
  }
}

// Guarded turntable tick: advances the angle, drops detached canvases,
// repaints, and reschedules. Stops when no live canvas remains. Never
// throws.
function previewTick(): void {
  previewRaf = null;
  try {
    previewAngle += 0.05;
    try {
      previewEntries = previewEntries.filter((entry) => {
        try {
          const connected = (entry.canvas as { isConnected?: unknown }).isConnected;
          return connected !== false;
        } catch {
          return true;
        }
      });
    } catch {
      // Best effort; a stale list still paints.
    }
    if (previewEntries.length === 0) {
      return;
    }
    repaintPreviews();
    schedulePreviewTick();
  } catch {
    // Display sinks never throw.
  }
}

function schedulePreviewTick(): void {
  try {
    const raf = (globalThis as unknown as { requestAnimationFrame?: unknown })
      .requestAnimationFrame;
    if (typeof raf !== "function") {
      return;
    }
    previewRaf = (raf as (fn: () => void) => number).call(globalThis, previewTick);
  } catch {
    previewRaf = null;
  }
}

// Start the turntable over the registered preview canvases; a single
// static repaint when rAF is absent (headless/stub DOM). Never throws.
function startPreviews(): void {
  try {
    if (previewEntries.length === 0) {
      return;
    }
    repaintPreviews();
    if (previewRaf !== null) {
      return;
    }
    schedulePreviewTick();
  } catch {
    // Display sinks never throw.
  }
}

// Stop the turntable and drop the canvas registry (idempotent). Never
// throws.
export function stopGaragePreviews(): void {
  try {
    if (previewRaf !== null) {
      try {
        const caf = (globalThis as unknown as { cancelAnimationFrame?: unknown })
          .cancelAnimationFrame;
        if (typeof caf === "function") {
          (caf as (handle: number) => void).call(globalThis, previewRaf);
        }
      } catch {
        // Best effort.
      }
      previewRaf = null;
    }
    previewEntries = [];
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const stop_garage_previews = stopGaragePreviews;

// Typed writer: paint the garage into the container. Each car owns a
// .car-card section (stat line, canvas.car-preview, select button); locked
// cards carry the Win requirement line and a disabled select button. One
// shared swatch row tints every preview. Car picks persist through
// gameState.selectCar/selectColor plus flush() for read-your-writes.
// Never throws, even with a null router.
export function renderGarage(
  container: HTMLElement,
  router?: Router | null,
): void {
  try {
    stopGaragePreviews();
    const root = screenRoot("screen-garage", "Garage");
    let unlocked: string[] = [];
    try {
      unlocked = gameState.unlockedCars ?? [];
    } catch {
      unlocked = [];
    }
    const grid = createTag("div");
    setProp(grid, "id", "car-grid");
    setProp(grid, "className", "car-grid");
    for (const carId of CAR_IDS) {
      try {
        const open = isCarUnlockedWith(carId, unlocked);
        const card = createTag("section");
        setProp(card, "id", `car-card-${carId}`);
        setProp(card, "className", "car-card");
        const name = staticLine(`car-name-${carId}`, carId);
        appendChild(card, name);
        const stats = staticLine(`car-stat-${carId}`, statLabelFor(carId));
        appendChild(card, stats);
        const preview = createTag("canvas");
        setProp(preview, "id", `car-preview-${carId}`);
        setProp(preview, "className", "car-preview");
        setProp(preview, "width", 120);
        setProp(preview, "height", 72);
        appendChild(card, preview);
        previewEntries.push({ canvas: preview, carId });
        const requirement = unlockRequirementFor(carId, unlocked);
        if (!open && requirement !== "") {
          const req = staticLine(`car-req-${carId}`, requirement);
          appendChild(card, req);
        }
        const select = menuButton(
          `btn-select-${carId}`,
          open ? `Select ${carId}` : `Select ${carId} 🔒 Locked`,
        );
        try {
          (select as unknown as { disabled: boolean }).disabled = !open;
        } catch {
          // Best effort on stub nodes.
        }
        if (open) {
          const pick = carId;
          onPress(select, () => {
            try {
              gameState.selectCar(pick);
              gameState.flush();
            } catch {
              // Selection faults never break the garage.
            }
            repaintPreviews();
          });
        }
        appendChild(card, select);
        appendChild(grid, card);
      } catch {
        // One bad car never blocks the garage.
      }
    }
    appendChild(root, grid);
    const swatches = createTag("div");
    setProp(swatches, "id", "swatch-row");
    setProp(swatches, "className", "swatch-row");
    for (let color = 0; color < COLOR_COUNT; color += 1) {
      try {
        const swatch = menuButton(`btn-color-${color}`, `Color ${color}`);
        try {
          const tint = colorCss(color);
          const style = (swatch as unknown as { style?: { background?: string } }).style;
          if (style !== undefined && style !== null) {
            style.background = tint;
          }
        } catch {
          // Best effort on stub nodes.
        }
        const slot = color;
        onPress(swatch, () => {
          try {
            gameState.selectColor(slot);
            gameState.flush();
          } catch {
            // Selection faults never break the garage.
          }
          repaintPreviews();
        });
        appendChild(swatches, swatch);
      } catch {
        // One bad swatch never blocks the garage.
      }
    }
    appendChild(root, swatches);
    const start = menuButton("btn-start", "Start Race");
    onPress(start, () => {
      try {
        let eventId = "";
        try {
          eventId = gameState.getCurrentEvent() || "";
        } catch {
          eventId = "";
        }
        if (eventId === "") {
          eventId = "harbor_sprint";
        }
        // Solo time-trial arms a 1-racer field (no AI); race mode arms
        // the full event field. The HUD-readable holders seed here:
        // stored best (null clears the delta) plus a zeroed drift total.
        const solo = gameState.isTimeTrialMode();
        try {
          manager.startEvent(eventId, solo ? 1 : undefined);
        } catch {
          manager.startEvent("harbor_sprint", solo ? 1 : undefined);
        }
        try {
          manager.driftTotal = 0;
          const stored = getBest(eventId);
          manager.best = stored > 0 ? stored : null;
        } catch {
          // Holder faults never block navigation.
        }
      } catch {
        // Arming faults never block navigation.
      }
      try {
        router?.show("race");
      } catch {
        // Navigation faults never break the garage.
      }
    });
    appendChild(root, start);
    const back = menuButton("btn-back", "Back");
    onPress(back, () => {
      try {
        router?.show("event-select");
      } catch {
        // Navigation faults never break the garage.
      }
    });
    appendChild(root, back);
    appendChild(container, root);
    startPreviews();
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const render_garage = renderGarage;
