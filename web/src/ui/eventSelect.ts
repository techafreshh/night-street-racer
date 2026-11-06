// Event-select screen (menu.gd event-select-mode port).
// Pure display sink in the hud.ts idiom: mode toggle plus one button per
// RaceEvent with the Progression.is_unlocked_with lock rule (open when
// unlock_req is empty, else open only when the requirement sits in the
// gameState unlock cache). Guarded; never throws.

import type { Router } from "../core/router";
import { EVENTS } from "../data/events";
import { gameState } from "../game/state";
import { appendChild, menuButton, onPress, screenRoot } from "./screens";

// Read the in-memory run mode without throwing (settings.gd poll idiom).
function isTimeTrial(): boolean {
  try {
    return gameState.isTimeTrialMode() === true;
  } catch {
    return false;
  }
}

// Disk-free lock rule over the gameState snapshot: an empty unlock_req is
// open from the start, otherwise the requirement must sit in the
// unlocked-events cache. Never throws.
function isUnlocked(unlockReq: unknown, unlocked: string[]): boolean {
  try {
    if (typeof unlockReq !== "string" || unlockReq === "") {
      return true;
    }
    return unlocked.includes(unlockReq);
  } catch {
    return false;
  }
}

// Typed writer: paint the event grid into the container. Unlocked picks
// persist through gameState.selectEvent and route to the garage; the Back
// button returns to the menu. Never throws, even with a null router.
export function renderEventSelect(
  container: HTMLElement,
  router?: Router | null,
): void {
  try {
    const root = screenRoot("screen-event-select", "Select Event");
    const mode = menuButton(
      "btn-mode",
      isTimeTrial() ? "Mode: Time Trial" : "Mode: Race",
    );
    onPress(mode, () => {
      try {
        if (gameState.isTimeTrialMode()) {
          gameState.selectMode("race");
        } else {
          gameState.selectMode("time_trial");
        }
      } catch {
        // Mode faults never break the grid.
      }
      try {
        (mode as unknown as { textContent: string }).textContent =
          isTimeTrial() ? "Mode: Time Trial" : "Mode: Race";
      } catch {
        // Display sinks never throw.
      }
    });
    appendChild(root, mode);
    let unlocked: string[] = [];
    try {
      unlocked = gameState.unlockedEvents ?? [];
    } catch {
      unlocked = [];
    }
    for (const event of EVENTS) {
      try {
        const open = isUnlocked(event.unlock_req, unlocked);
        const rivals =
          typeof event.rivals === "number" ? event.rivals : event.opponents;
        const label = `${event.route_id} (${event.laps} laps, ${rivals} rivals)${open ? "" : " 🔒 Locked"}`;
        const button = menuButton(`btn-event-${event.route_id}`, label);
        try {
          (button as unknown as { disabled: boolean }).disabled = !open;
        } catch {
          // Best effort on stub nodes.
        }
        if (open) {
          const routeId = event.route_id;
          onPress(button, () => {
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
          });
        }
        appendChild(root, button);
      } catch {
        // One bad event never blocks the grid.
      }
    }
    const back = menuButton("btn-back", "Back");
    onPress(back, () => {
      try {
        router?.show("menu");
      } catch {
        // Navigation faults never break the grid.
      }
    });
    appendChild(root, back);
    appendChild(container, root);
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const render_event_select = renderEventSelect;
