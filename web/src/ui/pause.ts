// Pause overlay (pause.gd port).
// The one deliberate non-router screen: an always-mounted hidden overlay
// so toggling never calls Router.show() (which replaceChildren()s the
// live race DOM underneath). Resume hides and unpauses, Restart re-arms
// the race clock via manager.resetRace(), Quit unpauses and routes home.
// Escape toggles through the same path (pause.gd _unhandled_input idiom).
// Guarded; never throws.

import type { Router } from "../core/router";
import { manager } from "../race/manager";
import { appendChild, menuButton, onPress, screenRoot } from "./screens";

export type PauseHandle = {
  element: HTMLElement | null;
  setVisible: (visible: boolean) => void;
  isVisible: () => boolean;
};

// Pause entry point behind the main.ts alias (setPaused gates the loop
// and the race clock). Falls back silently when no window handle exists
// (vitest/Node). Never throws.
function setPaused(paused: boolean): void {
  try {
    const w = globalThis as unknown as {
      __setPaused?: (value: boolean) => void;
      setPaused?: (value: boolean) => void;
    };
    if (typeof w.__setPaused === "function") {
      w.__setPaused(paused);
      return;
    }
    if (typeof w.setPaused === "function") {
      w.setPaused(paused);
    }
  } catch {
    // Pause faults never break the overlay.
  }
}

// Typed writer: append the hidden pause overlay next to the router
// container (sibling of #ui, so Router.show() swaps never destroy it)
// and return the visibility handle. Never throws, even with a null
// router or a detached root.
export function attachPause(
  root: HTMLElement,
  router?: Router | null,
): PauseHandle {
  let overlay: HTMLElement | null = null;
  let visible = false;
  const setVisible = (next: boolean): void => {
    visible = next === true;
    try {
      if (overlay !== null) {
        (overlay as unknown as { hidden: boolean }).hidden = !visible;
        const style = (overlay as unknown as { style?: { display?: string } })
          .style;
        if (style !== undefined && style !== null) {
          style.display = visible ? "" : "none";
        }
      }
    } catch {
      // Display sinks never throw.
    }
  };
  const isVisible = (): boolean => visible;
  try {
    const node = screenRoot("screen-pause", "Paused");
    overlay = node;
    const resume = menuButton("btn-resume", "Resume");
    onPress(resume, () => {
      setVisible(false);
      setPaused(false);
    });
    const restart = menuButton("btn-restart", "Restart");
    onPress(restart, () => {
      try {
        manager.resetRace();
      } catch {
        // Reset faults never break the overlay.
      }
      setVisible(false);
      setPaused(false);
    });
    const quit = menuButton("btn-quit", "Quit");
    onPress(quit, () => {
      setVisible(false);
      setPaused(false);
      try {
        router?.show("menu");
      } catch {
        // Navigation faults never break the overlay.
      }
    });
    appendChild(node, resume);
    appendChild(node, restart);
    appendChild(node, quit);
    setVisible(false);
    // Sibling host (never the router container itself): Router.show()
    // replaceChildren()s its container, which would destroy a child
    // overlay along with the live race DOM.
    let host: unknown = null;
    try {
      host = (root as unknown as { parentElement?: unknown }).parentElement ?? null;
    } catch {
      host = null;
    }
    if (host === null || host === undefined) {
      try {
        const doc = (globalThis as unknown as { document?: unknown })
          .document as
          | { body?: unknown }
          | undefined;
        host = doc?.body ?? null;
      } catch {
        host = null;
      }
    }
    if (host === null || host === undefined) {
      host = root;
    }
    appendChild(host, node);
    // Escape toggles only while a race is showing (router.current idiom
    // from main.ts boot): menu/settings/results/garage never surface the
    // overlay during the soak. A missing router still toggles so the
    // overlay stays usable when boot wiring is absent.
    const isRaceScreen = (): boolean => {
      try {
        if (router === null || router === undefined) {
          return true;
        }
        return router.current() === "race";
      } catch {
        return false;
      }
    };
    try {
      const w = globalThis as unknown as {
        addEventListener?: (type: string, listener: (e: unknown) => void) => void;
      };
      if (w !== undefined && typeof w.addEventListener === "function") {
        w.addEventListener("keydown", (event: unknown) => {
          try {
            const key = (event as { key?: unknown }).key;
            if (key === "Escape" || key === "ui_cancel") {
              if (!isRaceScreen()) {
                return;
              }
              if (isVisible()) {
                setVisible(false);
                setPaused(false);
              } else {
                setVisible(true);
                setPaused(true);
              }
            }
          } catch {
            // Display sinks never throw.
          }
        });
      }
    } catch {
      // Keyboard wiring is best effort.
    }
  } catch {
    // Display sinks never throw.
  }
  return { element: overlay, setVisible, isVisible };
}

// v1 snake_case alias (same reference).
export const attach_pause = attachPause;
