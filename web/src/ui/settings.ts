// Settings screen (settings.gd port).
// Pure display sink in the hud.ts idiom: master/music/sfx sliders plus
// assists and camera-shake toggles, seeded from the SettingsStore
// snapshot. Each change writes through the matching typed setter plus a
// synchronous settings.flush() so a reload test never races the deferred
// setTimeout(0) persist. Guarded; never throws.

import type { Router } from "../core/router";
import { settings } from "../game/settings";
import {
  appendChild,
  controlInput,
  menuButton,
  onChange,
  onPress,
  screenRoot,
} from "./screens";

// Live snapshot read without throwing (settings.gd poll idiom).
function snapshot(): {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  assists: boolean;
  cameraShake: boolean;
} {
  try {
    return settings.snapshot();
  } catch {
    return {
      masterVolume: 0.8,
      musicVolume: 0.7,
      sfxVolume: 0.9,
      assists: true,
      cameraShake: true,
    };
  }
}

// Synchronous write-through: typed setter plus an immediate flush so the
// value is durable before the handler returns. Never throws.
function writeVolume(
  key: "masterVolume" | "musicVolume" | "sfxVolume",
  value: number,
): void {
  try {
    const level = Number.isFinite(value) ? value : NaN;
    if (key === "masterVolume") {
      settings.masterVolume = level;
    } else if (key === "musicVolume") {
      settings.musicVolume = level;
    } else {
      settings.sfxVolume = level;
    }
  } catch {
    // Setter faults never break the screen.
  }
  try {
    settings.flush();
  } catch {
    // Flush faults never break the screen.
  }
}

// Synchronous write-through for toggles. Never throws.
function writeFlag(key: "assists" | "cameraShake", value: boolean): void {
  try {
    if (key === "assists") {
      settings.assists = value;
    } else {
      settings.cameraShake = value;
    }
  } catch {
    // Setter faults never break the screen.
  }
  try {
    settings.flush();
  } catch {
    // Flush faults never break the screen.
  }
}

// Seed one range slider from the snapshot and wire write-through.
function volumeRow(
  root: HTMLElement,
  id: string,
  label: string,
  key: "masterVolume" | "musicVolume" | "sfxVolume",
  level: number,
): void {
  try {
    const slider = controlInput(id, "range");
    try {
      const node = slider as unknown as {
        min: string;
        max: string;
        step: string;
        value: string;
      };
      node.min = "0";
      node.max = "1";
      node.step = "0.01";
      node.value = String(level);
    } catch {
      // Best effort on stub nodes.
    }
    onChange(slider, () => {
      try {
        const raw = (slider as unknown as { value: string }).value;
        writeVolume(key, Number.parseFloat(raw));
      } catch {
        // Display sinks never throw.
      }
    });
    appendChild(root, slider);
    try {
      (slider as unknown as { ariaLabel?: string }).ariaLabel = label;
    } catch {
      // Best effort on stub nodes.
    }
  } catch {
    // One bad row never blocks the screen.
  }
}

// Seed one checkbox from the snapshot and wire write-through.
function flagRow(
  root: HTMLElement,
  id: string,
  key: "assists" | "cameraShake",
  flag: boolean,
): void {
  try {
    const toggle = controlInput(id, "checkbox");
    try {
      (toggle as unknown as { checked: boolean }).checked = flag === true;
    } catch {
      // Best effort on stub nodes.
    }
    onChange(toggle, () => {
      try {
        const checked = (toggle as unknown as { checked: boolean }).checked;
        writeFlag(key, checked === true);
      } catch {
        // Display sinks never throw.
      }
    });
    appendChild(root, toggle);
  } catch {
    // One bad row never blocks the screen.
  }
}

// Typed writer: paint the settings into the container. Back returns to
// the menu. Never throws, even with a null router.
export function renderSettings(
  container: HTMLElement,
  router?: Router | null,
): void {
  try {
    const root = screenRoot("screen-settings", "Settings");
    const snap = snapshot();
    volumeRow(root, "vol-master", "Master volume", "masterVolume", snap.masterVolume);
    volumeRow(root, "vol-music", "Music volume", "musicVolume", snap.musicVolume);
    volumeRow(root, "vol-sfx", "SFX volume", "sfxVolume", snap.sfxVolume);
    flagRow(root, "tgl-assists", "assists", snap.assists);
    flagRow(root, "tgl-shake", "cameraShake", snap.cameraShake);
    const back = menuButton("btn-back", "Back");
    onPress(back, () => {
      try {
        router?.show("menu");
      } catch {
        // Navigation faults never break the screen.
      }
    });
    appendChild(root, back);
    appendChild(container, root);
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const render_settings = renderSettings;
