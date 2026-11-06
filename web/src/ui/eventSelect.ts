// Event-select screen (menu.gd event-select-mode port).
// Pure display sink in the hud.ts idiom: run-mode toggle plus one button
// per RaceEvent with the Progression.is_unlocked_with lock rule (open when
// unlock_req is empty, else open only when the requirement sits in the
// snapshot), a DRIFT tag on drift events, and a BEST tag from one
// allBests() snapshot per render. Element ids follow the Godot node-name
// spelling (ModeButton, InfoLabel, EventGrid, Event_<route_id>,
// BackButton); the previous hyphenated ids survive as hidden mirrors so
// the committed stub-DOM contract keeps resolving. Guarded; never throws.

import type { Router } from "../core/router";
import { EVENTS } from "../data/events";
import { isUnlockedWith, unlockedEvents } from "../game/progression";
import { allBests } from "../game/records";
import { gameState } from "../game/state";
import { formatTime } from "../race/timetrial";
import { appendChild, menuButton, onPress, screenRoot, staticLine } from "./screens";

// Read the in-memory run mode without throwing (settings.gd poll idiom).
function isTimeTrial(): boolean {
  try {
    return gameState.isTimeTrialMode() === true;
  } catch {
    return false;
  }
}

// Mode captions shared by the primary button and its legacy mirror.
function modeLabel(): string {
  return isTimeTrial() ? "Mode: Time Trial" : "Mode: Race";
}

// Solo/rivals helper line: time-trial runs alone against the clock,
// race runs the full field.
function infoLabel(): string {
  return isTimeTrial()
    ? "Solo time-trial · No AI · Beat your best"
    : "Race the field · Top 3 unlocks the next event";
}

// Park a legacy-id mirror: hidden in live DOM (stub-DOM clicks and reads
// still resolve it). Never throws.
function parkMirror(node: unknown): void {
  try {
    const el = node as {
      hidden?: boolean;
      style?: { display?: string };
    } | null;
    if (el === null || el === undefined) {
      return;
    }
    el.hidden = true;
    if (el.style !== undefined && el.style !== null) {
      el.style.display = "none";
    }
  } catch {
    // Display sinks never throw.
  }
}

// Event caption: base shape plus DRIFT/BEST tags plus the lock suffix.
function eventLabel(
  routeId: string,
  laps: number,
  rivals: number,
  isDrift: boolean,
  best: number | null,
  open: boolean,
): string {
  let label = `${routeId} (${laps} laps, ${rivals} rivals)`;
  if (isDrift) {
    label += " · DRIFT";
  }
  if (best !== null) {
    label += ` · BEST ${formatTime(best)}`;
  }
  if (!open) {
    label += " 🔒 Locked";
  }
  return label;
}

// Typed writer: paint the event grid into the container. Entering the
// screen defaults the run mode to race; the ModeButton toggles
// gameState.selectMode with the InfoLabel following. Event picks persist
// through gameState.selectEvent and route to the garage; Back returns to
// the menu. Never throws, even with a null router.
export function renderEventSelect(
  container: HTMLElement,
  router?: Router | null,
): void {
  try {
    try {
      gameState.selectMode("race");
    } catch {
      // Mode faults never break the grid.
    }
    const root = screenRoot("screen-event-select", "Select Event");
    const mode = menuButton("ModeButton", modeLabel());
    const modeMirror = menuButton("btn-mode", modeLabel());
    parkMirror(modeMirror);
    const info = staticLine("InfoLabel", infoLabel());
    const syncMode = (): void => {
      try {
        (mode as unknown as { textContent: string }).textContent =
          modeLabel();
        (modeMirror as unknown as { textContent: string }).textContent =
          modeLabel();
        (info as unknown as { textContent: string }).textContent = infoLabel();
      } catch {
        // Display sinks never throw.
      }
    };
    const toggle = (): void => {
      try {
        if (gameState.isTimeTrialMode()) {
          gameState.selectMode("race");
        } else {
          gameState.selectMode("time_trial");
        }
      } catch {
        // Mode faults never break the grid.
      }
      syncMode();
    };
    onPress(mode, toggle);
    onPress(modeMirror, toggle);
    appendChild(root, mode);
    appendChild(root, modeMirror);
    appendChild(root, info);
    let unlocked: string[] = [];
    try {
      unlocked = unlockedEvents();
    } catch {
      unlocked = [];
    }
    let bests: Record<string, number> = {};
    try {
      bests = allBests();
    } catch {
      bests = {};
    }
    const grid = staticLine("EventGrid", "");
    try {
      (grid as unknown as { textContent: string }).textContent = "";
    } catch {
      // Best effort on stub nodes.
    }
    for (const event of EVENTS) {
      try {
        const open = isUnlockedWith(event.unlock_req, unlocked);
        const rivals =
          typeof event.rivals === "number" ? event.rivals : event.opponents;
        const rawBest = bests[event.route_id];
        const best =
          typeof rawBest === "number" && Number.isFinite(rawBest) && rawBest > 0
            ? rawBest
            : null;
        const label = eventLabel(
          event.route_id,
          event.laps,
          rivals,
          event.event_type === "drift",
          best,
          open,
        );
        const button = menuButton(`Event_${event.route_id}`, label);
        const mirror = menuButton(`btn-event-${event.route_id}`, label);
        parkMirror(mirror);
        try {
          (button as unknown as { disabled: boolean }).disabled = !open;
          (mirror as unknown as { disabled: boolean }).disabled = !open;
        } catch {
          // Best effort on stub nodes.
        }
        if (open) {
          const routeId = event.route_id;
          const pick = (): void => {
            try {
              gameState.selectEvent(routeId);
            } catch {
              // Selection faults never block navigation.
            }
            try {
              router?.show("garage");
            } catch {
              // Navigation faults never break the grid.
            }
          };
          onPress(button, pick);
          onPress(mirror, pick);
        }
        appendChild(grid, button);
        appendChild(grid, mirror);
      } catch {
        // One bad event never blocks the grid.
      }
    }
    appendChild(root, grid);
    const back = menuButton("BackButton", "Back");
    const backMirror = menuButton("btn-back", "Back");
    parkMirror(backMirror);
    const goMenu = (): void => {
      try {
        router?.show("menu");
      } catch {
        // Navigation faults never break the grid.
      }
    };
    onPress(back, goMenu);
    onPress(backMirror, goMenu);
    appendChild(root, back);
    appendChild(root, backMirror);
    appendChild(container, root);
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const render_event_select = renderEventSelect;
