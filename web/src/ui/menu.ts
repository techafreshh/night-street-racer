// Main-menu screen (menu.gd main-mode port).
// Pure display sink in the hud.ts idiom: builds #screen-menu with the
// Race/Garage/Settings buttons and routes through the injected Router.
// Guarded so a missing router only parks navigation; never throws.

import type { Router } from "../core/router";
import { appendChild, menuButton, onPress, screenRoot } from "./screens";

// Typed writer: paint the menu into the container (Router.show calls with
// the container; the router selects the next screen). Never throws, even
// with a null router.
export function renderMenu(
  container: HTMLElement,
  router?: Router | null,
): void {
  try {
    const root = screenRoot("screen-menu", "Night Street Racer");
    const race = menuButton("btn-race", "Race");
    onPress(race, () => {
      try {
        router?.show("event-select");
      } catch {
        // Navigation faults never break the menu.
      }
    });
    const garage = menuButton("btn-garage", "Garage");
    onPress(garage, () => {
      try {
        router?.show("garage");
      } catch {
        // Navigation faults never break the menu.
      }
    });
    const settings = menuButton("btn-settings", "Settings");
    onPress(settings, () => {
      try {
        router?.show("settings");
      } catch {
        // Navigation faults never break the menu.
      }
    });
    appendChild(root, race);
    appendChild(root, garage);
    appendChild(root, settings);
    appendChild(container, root);
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const render_menu = renderMenu;
