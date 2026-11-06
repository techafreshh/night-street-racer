// Results screen (results.gd port).
// Pure display sink in the hud.ts idiom: reads the in-memory post-race
// handoff via gameState.getLastResult() and falls back to the results.gd
// mock (player P3 on harbor_sprint, 5 fixed rows) when the handoff is
// missing or invalid. Rows render into #ResultsList (player rows marked),
// a DRIFT +N line follows when the handoff carries a judged score, fresh
// unlocks show #UnlockBanner and fresh bests show #BestBanner (both hidden
// otherwise), and Retry/Next/Menu route onward. Element ids follow the
// Godot node-name spelling (ResultsList, DriftLine, UnlockBanner,
// BestBanner, NextButton, RetryButton, MenuButton); the previous
// hyphenated ids survive as hidden mirrors so the committed stub-DOM
// contract keeps resolving. This screen is the sole bests writer: podium
// unlocks go through gameState.applyResult, lap bests through
// records.saveBestIfFaster, judged scores through
// records.saveBestIfHigher. Guarded; never throws.

import type { Router } from "../core/router";
import { nextEventAfter } from "../game/progression";
import {
  getBest,
  saveBestIfFaster,
  saveBestIfHigher,
} from "../game/records";
import { gameState } from "../game/state";
import { manager } from "../race/manager";
import { armGridForEvent } from "../race/grid";
import { placePlayerOnGrid } from "../race/placement";
import { sharedTraffic } from "../traffic/traffic";
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
  driftScore: number;
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

// Fixed deterministic mock, first 5 rows by place, no judged score.
function mockResult(): ResolvedResult {
  const places: ResultRow[] = MOCK_RACERS.map((racer, i) => ({
    racer,
    time_s: MOCK_TIMES[i] ?? 0,
    place: i + 1,
  }));
  return { eventId: MOCK_EVENT, places, playerRacer: MOCK_PLAYER, driftScore: 0 };
}

// Resolve the handoff via the gameState reader; accept it only when
// event_id is non-empty and places holds 1+ valid rows (sorted by place,
// first 5 kept). Anything missing or invalid falls back to the mock.
// drift_score truncates to a whole non-negative int (0 when absent).
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
    const driftRaw = raw.drift_score;
    const driftScore =
      typeof driftRaw === "number" && Number.isFinite(driftRaw)
        ? Math.max(0, Math.trunc(driftRaw))
        : 0;
    return { eventId, places: rows, playerRacer, driftScore };
  } catch {
    return mockResult();
  }
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

// Guarded banner reveal on a primary/mirror pair: same text, both
// unhidden (the mirror stays display-parked via parkMirror, so it never
// shows in live DOM). Never throws.
function showBanner(primary: unknown, mirror: unknown, text: string): void {
  for (const node of [primary, mirror]) {
    try {
      const el = node as unknown as {
        textContent: string;
        hidden: boolean;
        style?: { display?: string };
      } | null;
      if (el === null || el === undefined) {
        continue;
      }
      el.textContent = text;
      el.hidden = false;
      if (node === primary && el.style !== undefined && el.style !== null) {
        el.style.display = "";
      }
    } catch {
      // Display sinks never throw.
    }
  }
}

// Guarded banner park on a primary/mirror pair: hidden, no text change
// needed. Never throws.
function hideBanner(primary: unknown, mirror: unknown): void {
  for (const node of [primary, mirror]) {
    try {
      const el = node as unknown as {
        hidden: boolean;
        style?: { display?: string };
      } | null;
      if (el === null || el === undefined) {
        continue;
      }
      el.hidden = true;
      if (el.style !== undefined && el.style !== null) {
        el.style.display = "none";
      }
    } catch {
      // Display sinks never throw.
    }
  }
}

// Seed the HUD-readable holders after arming (race.gd _cached_best
// idiom): the stored best (null clears the delta) plus a zeroed judged
// total. Never throws.
function seedHudBest(eventId: string): void {
  try {
    manager.driftTotal = 0;
  } catch {
    // Display sinks never throw.
  }
  try {
    const stored = getBest(eventId);
    manager.best = stored > 0 ? stored : null;
  } catch {
    try {
      manager.best = null;
    } catch {
      // Display sinks never throw.
    }
  }
}

// Typed writer: paint the results into the container. Retry re-arms the
// manager on the same event (solo field in time-trial mode), Next
// advances the ladder then returns to event select, Menu returns home.
// Never throws, even with a null router.
export function renderResults(
  container: HTMLElement,
  router?: Router | null,
): void {
  try {
    const resolved = resolveResult();
    const root = screenRoot("screen-results", "Results");
    const unlockBanner = staticLine("UnlockBanner", "");
    const unlockMirror = staticLine("banner-unlock", "");
    parkMirror(unlockMirror);
    hideBanner(unlockBanner, unlockMirror);
    const bestBanner = staticLine("BestBanner", "");
    const bestMirror = staticLine("banner-best", "");
    parkMirror(bestMirror);
    hideBanner(bestBanner, bestMirror);
    appendChild(root, unlockBanner);
    appendChild(root, unlockMirror);
    appendChild(root, bestBanner);
    appendChild(root, bestMirror);
    const { list, mirror } = buildList(resolved);
    appendChild(root, list);
    appendChild(root, mirror);
    if (resolved.driftScore > 0) {
      appendChild(
        root,
        staticLine("DriftLine", `DRIFT +${resolved.driftScore}`),
      );
    }
    // Record the podium through the GameState wrapper and refresh the
    // bests through the records owner: UnlockBanner shows only fresh
    // earns, BestBanner only on improvement.
    applyProgression(resolved, unlockBanner, unlockMirror, bestBanner, bestMirror);
    const retry = menuButton("RetryButton", "Retry");
    const retryMirror = menuButton("btn-retry", "Retry");
    parkMirror(retryMirror);
    const armSame = (): void => {
      try {
        const solo = gameState.isTimeTrialMode();
        try {
          manager.startEvent(resolved.eventId, solo ? 1 : undefined);
        } catch {
          manager.startEvent(MOCK_EVENT, solo ? 1 : undefined);
        }
        // Retry re-arms the full grid like main.ts startRace so the
        // retry matches a fresh arm (same car, same traffic mode).
        try {
          const carId = gameState.getSelectedCar() || gameState.getDefaultCar();
          const effective = manager.eventId !== "" ? manager.eventId : resolved.eventId;
          armGridForEvent(effective, { carId, solo });
        } catch {
          // Grid faults never block navigation.
        }
        // Player placement mirrors main.ts startRace: pin the live body
        // onto the shared grid slot once per retry. Guarded like arming.
        try {
          placePlayerOnGrid();
        } catch {
          // Placement faults never block navigation.
        }
        try {
          sharedTraffic().setActive(!solo);
        } catch {
          // Traffic-mode faults never block navigation.
        }
        seedHudBest(resolved.eventId);
      } catch {
        // Arming faults never block navigation.
      }
      try {
        router?.show("race");
      } catch {
        // Navigation faults never break results.
      }
    };
    onPress(retry, armSame);
    onPress(retryMirror, armSame);
    const next = menuButton("NextButton", "Next");
    const nextMirror = menuButton("btn-next", "Next");
    parkMirror(nextMirror);
    const advance = (): void => {
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
        // Ladder faults never break results.
      }
      try {
        router?.show("event-select");
      } catch {
        // Navigation faults never break results.
      }
    };
    onPress(next, advance);
    onPress(nextMirror, advance);
    const menu = menuButton("MenuButton", "Menu");
    const menuMirror = menuButton("btn-menu", "Menu");
    parkMirror(menuMirror);
    const goMenu = (): void => {
      try {
        router?.show("menu");
      } catch {
        // Navigation faults never break results.
      }
    };
    onPress(menu, goMenu);
    onPress(menuMirror, goMenu);
    appendChild(root, retry);
    appendChild(root, retryMirror);
    appendChild(root, next);
    appendChild(root, nextMirror);
    appendChild(root, menu);
    appendChild(root, menuMirror);
    appendChild(container, root);
  } catch {
    // Display sinks never throw.
  }
}

// Build #ResultsList plus its legacy mirror: one row per place
// ("P<place>  <racer>  <mm:ss.mmm>", the player row marked). The two
// lists are siblings so row counts stay exact on both spellings.
function buildList(resolved: ResolvedResult): {
  list: HTMLElement;
  mirror: HTMLElement;
} {
  const list = staticLine("ResultsList", "");
  const mirror = staticLine("results-list", "");
  parkMirror(mirror);
  try {
    (list as unknown as { textContent: string }).textContent = "";
    (mirror as unknown as { textContent: string }).textContent = "";
  } catch {
    // Best effort on stub nodes.
  }
  for (const row of resolved.places) {
    try {
      const text = `P${row.place}  ${row.racer}  ${formatTime(row.time_s)}`;
      const marked = row.racer === resolved.playerRacer ? `▶ ${text}` : text;
      appendChild(list, staticLine(`ResultRow_${row.place}`, marked));
      appendChild(mirror, staticLine(`result-row-${row.place}`, marked));
    } catch {
      // One bad row never blocks the list.
    }
  }
  return { list, mirror };
}

// Record the podium and reveal fresh banners. The results screen owns
// every bests write: lap bests via records.saveBestIfFaster, judged
// scores via records.saveBestIfHigher. Never throws.
function applyProgression(
  resolved: ResolvedResult,
  unlockBanner: HTMLElement,
  unlockMirror: HTMLElement,
  bestBanner: HTMLElement,
  bestMirror: HTMLElement,
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
        showBanner(unlockBanner, unlockMirror, `NEW UNLOCK: ${tokens.join(" + ")}`);
      }
    } catch {
      // Unlock faults never break results.
    }
    try {
      // Lap and judged bests persist independently (a drift run always
      // carries a time too); the banner names the lap best first.
      const lapBest = saveBestIfFaster(resolved.eventId, playerTime, playerPlace);
      const driftBest =
        resolved.driftScore > 0 &&
        saveBestIfHigher(resolved.eventId, resolved.driftScore);
      if (lapBest) {
        showBanner(
          bestBanner,
          bestMirror,
          `NEW BEST: ${formatTime(playerTime)}`,
        );
      } else if (driftBest) {
        showBanner(
          bestBanner,
          bestMirror,
          `NEW DRIFT BEST: +${resolved.driftScore}`,
        );
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
