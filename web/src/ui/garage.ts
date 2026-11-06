// Garage screen (garage.gd port).
// Pure display sink in the hud.ts idiom: one button per catalog car with
// live tune stats and the Progression.is_car_unlocked_with lock rule
// (sedan always open, others only when in the gameState unlock cache),
// four paint swatches, and Start/Back. Start arms the race manager on the
// selected event (harbor_sprint fallback) and routes to the race screen.
// Guarded; never throws.

import type { Router } from "../core/router";
import { getTune } from "../data/tunes";
import { gameState } from "../game/state";
import { manager } from "../race/manager";
import { appendChild, menuButton, onPress, screenRoot } from "./screens";

// Catalog order mirrors GarageUI.CAR_IDS so probes read the same ids.
export const CAR_IDS = ["sedan", "coupe", "hatch", "awd"] as const;

export const COLOR_COUNT = 4;

// Disk-free car lock rule over the gameState snapshot (garage.gd
// is_car_unlocked_with idiom): sedan is always open, otherwise the car
// must sit in the unlocked-cars cache. Never throws.
function isCarUnlocked(carId: string, unlocked: string[]): boolean {
  try {
    if (carId === "sedan") {
      return true;
    }
    return unlocked.includes(carId);
  } catch {
    return false;
  }
}

// Typed writer: paint the garage into the container. Car picks persist
// through gameState.selectCar, paint through selectColor. Never throws,
// even with a null router.
export function renderGarage(
  container: HTMLElement,
  router?: Router | null,
): void {
  try {
    const root = screenRoot("screen-garage", "Garage");
    let unlocked: string[] = [];
    try {
      unlocked = gameState.unlockedCars ?? [];
    } catch {
      unlocked = [];
    }
    for (const carId of CAR_IDS) {
      try {
        const open = isCarUnlocked(carId, unlocked);
        const tune = getTune(carId);
        const stats =
          tune !== undefined
            ? ` (${Math.trunc(tune.engine_torque)} Nm, ${tune.tire_grip_front.toFixed(2)}/${tune.tire_grip_rear.toFixed(2)}, ${tune.drivetrain})`
            : "";
        const button = menuButton(
          `btn-car-${carId}`,
          `${carId}${stats}${open ? "" : " 🔒 Locked"}`,
        );
        try {
          (button as unknown as { disabled: boolean }).disabled = !open;
        } catch {
          // Best effort on stub nodes.
        }
        if (open) {
          onPress(button, () => {
            try {
              gameState.selectCar(carId);
            } catch {
              // Selection faults never break the garage.
            }
          });
        }
        appendChild(root, button);
      } catch {
        // One bad car never blocks the garage.
      }
    }
    for (let color = 0; color < COLOR_COUNT; color += 1) {
      try {
        const swatch = menuButton(`btn-color-${color}`, `Color ${color}`);
        const slot = color;
        onPress(swatch, () => {
          try {
            gameState.selectColor(slot);
          } catch {
            // Selection faults never break the garage.
          }
        });
        appendChild(root, swatch);
      } catch {
        // One bad swatch never blocks the garage.
      }
    }
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
        try {
          manager.startEvent(eventId);
        } catch {
          manager.startEvent("harbor_sprint");
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
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const render_garage = renderGarage;
