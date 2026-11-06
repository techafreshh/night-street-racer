// Results screen (results.gd port).
// Pure display sink in the hud.ts idiom: reads the in-memory post-race
// handoff via gameState.getLastResult() and falls back to the results.gd
// mock (player P3 on harbor_sprint, 5 fixed rows) when the handoff is
// missing or invalid. Rows render into #results-list, fresh unlocks show
// #banner-unlock and fresh bests show #banner-best (both hidden
// otherwise), and Retry/Next/Menu route onward. Guarded; never throws.

import type { Router } from "../core/router";
import { gameState } from "../game/state";
import { nextEventAfter } from "../game/progression";
import { loadSave, saveNow } from "../game/save";
import { manager } from "../race/manager";
import { formatTime } from "../race/timetrial";
import { appendChild, menuButton, onPress, screenRoot, staticLine } from "./screens";

// Fixed deterministic mock (results.gd MOCK_* idiom): player P3 on
// harbor_sprint, 5 rows, so standalone boots always reach results.
const MOCK_EVENT = "harbor_sprint";
const MOCK_PLAYER = "player";
const MOCK_TIMES = [85.2, 87.1, 88.2, 91.0, 95.5];
const MOCK_RACERS = ["ai_1", "ai_2", "player", "ai_3", "ai_4"];

export type ResultRow = {
  racer: string;
  time_s: number;
  place: number;
};

export type ResolvedResult = {
  eventId: string;
  places: ResultRow[];
  playerRacer: string;
};

// Validate one handoff row ({racer, time_s, place}); null when invalid.
function toRow(entry: unknown): ResultRow | null {
  try {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.racer !== "string" || row.racer === "") {
      return null;
    }
    if (typeof row.time_s !== "number" || !Number.isFinite(row.time_s)) {
      return null;
    }
    if (typeof row.place !== "number" || !Number.isFinite(row.place)) {
      return null;
    }
    return {
      racer: row.racer,
      time_s: Math.max(0, row.time_s),
      place: Math.trunc(row.place),
    };
  } catch {
    return null;
  }
}

// Fixed deterministic mock, first 5 rows by place.
function mockResult(): ResolvedResult {
  const places: ResultRow[] = MOCK_RACERS.map((racer, i) => ({
    racer,
    time_s: MOCK_TIMES[i] ?? 0,
    place: i + 1,
  }));
  return { eventId: MOCK_EVENT, places, playerRacer: MOCK_PLAYER };
}

// Resolve the handoff via the gameState reader; accept it only when
// event_id is non-empty and places holds 1+ valid rows (sorted by place,
// first 5 kept). Anything missing or invalid falls back to the mock.
// Never throws.
function resolveResult(): ResolvedResult {
  try {
    const raw = gameState.getLastResult() as Record<string, unknown>;
    const eventId = raw.event_id;
    const places = raw.places;
    if (typeof eventId !== "string" || eventId === "") {
      return mockResult();
    }
    if (!Array.isArray(places) || places.length === 0) {
      return mockResult();
    }
    const rows: ResultRow[] = [];
    for (const entry of places) {
      const row = toRow(entry);
      if (row === null) {
        return mockResult();
      }
      rows.push(row);
    }
    if (rows.length === 0) {
      return mockResult();
    }
    rows.sort((a, b) => a.place - b.place);
    while (rows.length > 5) {
      rows.pop();
    }
    const playerRaw = raw.player_racer;
    const playerRacer =
      typeof playerRaw === "string" && playerRaw !== ""
        ? playerRaw
        : MOCK_PLAYER;
    return { eventId, places: rows, playerRacer };
  } catch {
    return mockResult();
  }
}

// Guarded banner reveal: text plus unhide. Never throws.
function showBanner(banner: unknown, text: string): void {
  try {
    const node = banner as unknown as {
      textContent: string;
      hidden: boolean;
      style?: { display?: string };
    } | null;
    if (node === null || node === undefined) {
      return;
    }
    node.textContent = text;
    node.hidden = false;
    if (node.style !== undefined && node.style !== null) {
      node.style.display = "";
    }
  } catch {
    // Display sinks never throw.
  }
}

// Guarded banner park: hidden with no text change needed. Never throws.
function hideBanner(banner: unknown): void {
  try {
    const node = banner as unknown as {
      hidden: boolean;
      style?: { display?: string };
    } | null;
    if (node === null || node === undefined) {
      return;
    }
    node.hidden = true;
    if (node.style !== undefined && node.style !== null) {
      node.style.display = "none";
    }
  } catch {
    // Display sinks never throw.
  }
}

// Best-time compare through a SaveSystem load-modify-save round-trip
// (TimeTrial.save_best_if_faster idiom): true only when the time beats
// the stored best or no record exists yet. Every disk call is guarded.
// Never throws.
function saveBestIfFaster(eventId: string, timeS: number, place: number): boolean {
  try {
    if (eventId === "" || !Number.isFinite(timeS) || timeS <= 0) {
      return false;
    }
    const data = loadSave();
    const table = data.records as unknown as Record<string, unknown>;
    const existing = table[eventId] as Record<string, unknown> | undefined;
    if (
      existing !== undefined &&
      existing !== null &&
      typeof existing === "object"
    ) {
      const stored = (existing as Record<string, unknown>).best_time_s;
      if (typeof stored === "number" && Number.isFinite(stored)) {
        if (stored <= timeS) {
          return false;
        }
      }
    }
    const merged: Record<string, unknown> =
      existing !== undefined &&
      existing !== null &&
      typeof existing === "object"
        ? { ...(existing as Record<string, unknown>) }
        : {};
    merged.best_time_s = timeS;
    merged.best_position = place;
    table[eventId] = merged;
    data.records = table as typeof data.records;
    saveNow(data);
    return true;
  } catch {
    return false;
  }
}

// Typed writer: paint the results into the container. Retry re-arms the
// manager on the same event, Next advances the ladder then returns to
// event select, Menu returns home. Never throws, even with a null router.
export function renderResults(
  container: HTMLElement,
  router?: Router | null,
): void {
  try {
    const resolved = resolveResult();
    const root = screenRoot("screen-results", "Results");
    const unlockBanner = staticLine("banner-unlock", "");
    hideBanner(unlockBanner);
    const bestBanner = staticLine("banner-best", "");
    hideBanner(bestBanner);
    appendChild(root, unlockBanner);
    appendChild(root, bestBanner);
    appendChild(root, buildList(resolved));
    // Record the podium through the GameState wrapper and refresh the
    // best time through the save records: UnlockBanner shows only fresh
    // earns, BestBanner only on improvement.
    applyProgression(resolved, unlockBanner, bestBanner);
    const retry = menuButton("btn-retry", "Retry");
    onPress(retry, () => {
      try {
        try {
          manager.startEvent(resolved.eventId);
        } catch {
          manager.startEvent(MOCK_EVENT);
        }
      } catch {
        // Arming faults never block navigation.
      }
      try {
        router?.show("race");
      } catch {
        // Navigation faults never break results.
      }
    });
    const next = menuButton("btn-next", "Next");
    onPress(next, () => {
      try {
        const upcoming = nextEventAfter(resolved.eventId);
        if (upcoming !== "") {
          try {
            gameState.selectEvent(upcoming);
          } catch {
            // Selection faults never block navigation.
          }
        }
      } catch {
        // Ladder faults never block navigation.
      }
      try {
        router?.show("event-select");
      } catch {
        // Navigation faults never break results.
      }
    });
    const menu = menuButton("btn-menu", "Menu");
    onPress(menu, () => {
      try {
        router?.show("menu");
      } catch {
        // Navigation faults never break results.
      }
    });
    appendChild(root, retry);
    appendChild(root, next);
    appendChild(root, menu);
    appendChild(container, root);
  } catch {
    // Display sinks never throw.
  }
}

// Build #results-list: one row per place ("P1  player  01:28.200"), the
// player row marked, then hidden-banner-safe even without a list parent.
function buildList(resolved: ResolvedResult): HTMLElement {
  const list = staticLine("results-list", "");
  for (const row of resolved.places) {
    try {
      const line = staticLine(
        `result-row-${row.place}`,
        `P${row.place}  ${row.racer}  ${formatTime(row.time_s)}`,
      );
      try {
        if (row.racer === resolved.playerRacer) {
          (line as unknown as { textContent: string }).textContent =
            `▶ P${row.place}  ${row.racer}  ${formatTime(row.time_s)}`;
        }
      } catch {
        // Best effort on stub nodes.
      }
      appendChild(list, line);
    } catch {
      // One bad row never blocks the list.
    }
  }
  return list;
}

// Record the podium and reveal fresh banners. Never throws.
function applyProgression(
  resolved: ResolvedResult,
  unlockBanner: HTMLElement,
  bestBanner: HTMLElement,
): void {
  try {
    if (resolved.eventId === "" || resolved.places.length === 0) {
      return;
    }
    let playerPlace = 0;
    let playerTime = 0;
    for (const row of resolved.places) {
      if (row.racer === resolved.playerRacer) {
        playerPlace = row.place;
        playerTime = row.time_s;
        break;
      }
    }
    if (playerPlace <= 0) {
      return;
    }
    try {
      const snap = gameState.applyResult(resolved.eventId, playerPlace);
      const tokens: string[] = [];
      if (
        typeof snap.eventUnlocked === "string" &&
        snap.eventUnlocked !== ""
      ) {
        tokens.push(snap.eventUnlocked);
      }
      if (typeof snap.carUnlocked === "string" && snap.carUnlocked !== "") {
        tokens.push(snap.carUnlocked);
      }
      if (tokens.length > 0) {
        showBanner(unlockBanner, `NEW UNLOCK: ${tokens.join(" + ")}`);
      }
    } catch {
      // Unlock faults never break results.
    }
    try {
      if (saveBestIfFaster(resolved.eventId, playerTime, playerPlace)) {
        showBanner(bestBanner, `NEW BEST: ${formatTime(playerTime)}`);
      }
    } catch {
      // Best faults never break results.
    }
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const render_results = renderResults;
