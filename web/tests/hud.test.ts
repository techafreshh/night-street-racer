// HUD acceptance suite (issue #218 contract): pure-format assertions
// plus stub-DOM setter tests (core.test.ts stub-container idiom) with
// no network, no WebGL, no WASM. Covers the 20m/s->72 + gear 3 read,
// the exact 2/4 position text, R/N/clamp gears, hidden-without-race,
// drift popup text plus 1.5 s fade expiry, and a static hygiene scan
// proving the ui/ module carries no three.js/rapier import.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  attachRace,
  attach_race,
  clearDelta,
  ensureHud,
  formatDelta,
  formatTime,
  gearTextFor,
  gear_text_for,
  lapTextFor,
  lap_text_for,
  positionTextFor,
  position_text_for,
  setDelta,
  setGear,
  setLapPosition,
  setRaceTime,
  setSpeed,
  showDrift,
  speedKmhFor,
  speed_kmh_for,
  update,
  updateHud,
  type HudDocumentLike,
  type HudNodeLike,
} from "../src/ui/hud";

function makeNode(): HudNodeLike {
  return { textContent: "", hidden: false, style: { display: "", opacity: "1" } };
}

function makeDoc(): { doc: HudDocumentLike; nodes: Map<string, HudNodeLike> } {
  const nodes = new Map<string, HudNodeLike>();
  for (const id of [
    "hud",
    "hud-speed",
    "hud-gear",
    "hud-lap",
    "hud-position",
    "hud-timer",
    "hud-delta",
    "hud-drift",
  ]) {
    nodes.set(id, makeNode());
  }
  const doc: HudDocumentLike = {
    getElementById: (id: string) => nodes.get(id) ?? null,
  };
  ensureHud(doc);
  return { doc, nodes };
}

function raceOf(overrides: Record<string, unknown> = {}): {
  pos: number;
  total: number;
  lap: number;
  laps: number;
  raceTime: number;
} {
  return { pos: 1, total: 1, lap: 1, laps: 1, raceTime: 0, ...overrides };
}

describe("hud speed and gear", () => {
  it("reads 20m/s as 72 km/h", () => {
    expect(speedKmhFor(20)).toBe(72);
    expect(speed_kmh_for(20)).toBe(72);
  });

  it("shows 72 and gear 3 while racing at 20m/s in gear 3", () => {
    const { nodes } = makeDoc();
    update(
      {
        vehicle: { speedMs: 20, currentGear: 3 },
        race: raceOf({ pos: 2, total: 4, raceTime: 65.5 }),
      },
      1 / 60,
    );
    expect(nodes.get("hud-speed")?.textContent).toContain("72");
    expect(nodes.get("hud-gear")?.textContent).toContain("3");
  });

  it("reads R while reversing and N near standstill", () => {
    expect(gearTextFor(-2, 1)).toBe("R");
    expect(gearTextFor(0, 3)).toBe("N");
    expect(gearTextFor(0.2, 3)).toBe("N");
    expect(gear_text_for(-2, 1)).toBe("R");
  });

  it("clamps the forward gear into 1-5", () => {
    expect(gearTextFor(10, 9)).toBe("5");
    expect(gearTextFor(10, 0)).toBe("1");
    expect(gearTextFor(10, 3)).toBe("3");
  });

  it("pushes speed and gear through the setters", () => {
    const { nodes } = makeDoc();
    setSpeed(20);
    setGear(3);
    expect(nodes.get("hud-speed")?.textContent).toContain("72");
    expect(nodes.get("hud-gear")?.textContent).toBe("3");
  });
});

describe("hud lap and position", () => {
  it("renders position exactly as pos/total", () => {
    expect(positionTextFor(2, 4)).toBe("2/4");
    expect(position_text_for(2, 4)).toBe("2/4");
  });

  it("renders lap exactly as lap/laps", () => {
    expect(lapTextFor(2, 3)).toBe("2/3");
    expect(lap_text_for(2, 3)).toBe("2/3");
  });

  it("shows 2/4 while racing 2nd of 4", () => {
    const { nodes } = makeDoc();
    update(
      {
        vehicle: { speedMs: 20, currentGear: 3 },
        race: raceOf({ pos: 2, total: 4 }),
      },
      1 / 60,
    );
    expect(nodes.get("hud-position")?.textContent).toBe("2/4");
  });

  it("pushes lap and position through setLapPosition", () => {
    const { nodes } = makeDoc();
    setLapPosition(2, 4, 1, 3);
    expect(nodes.get("hud-position")?.textContent).toBe("2/4");
    expect(nodes.get("hud-lap")?.textContent).toBe("1/3");
  });
});

describe("hud clock and delta", () => {
  it("formats 65.5s as 01:05.500 through the setter", () => {
    const { nodes } = makeDoc();
    setRaceTime(65.5);
    expect(nodes.get("hud-timer")?.textContent).toBe("01:05.500");
    expect(formatTime(65.5)).toBe("01:05.500");
  });

  it("shows a signed live delta while racing against a best", () => {
    const { nodes } = makeDoc();
    update(
      {
        vehicle: { speedMs: 10, currentGear: 2 },
        race: { ...raceOf({ raceTime: 93.241 }), best: 95.0 },
      },
      1 / 60,
    );
    expect(nodes.get("hud-delta")?.textContent).toBe(formatDelta(93.241 - 95.0));
  });

  it("parks the delta placeholder when no best exists", () => {
    const { nodes } = makeDoc();
    setDelta(1.2);
    expect(nodes.get("hud-delta")?.textContent).toBe("+00:01.200");
    clearDelta();
    expect(nodes.get("hud-delta")?.textContent).toBe("--:--.---");
    expect(nodes.get("hud-delta")?.hidden).toBe(true);
  });
});

describe("hud visibility without a race", () => {
  it("hides #hud and never throws when no race is attached", () => {
    const { nodes } = makeDoc();
    expect(() => update({ vehicle: { speedMs: 20, currentGear: 3 }, race: null })).not.toThrow();
    expect(nodes.get("hud")?.hidden).toBe(true);
    expect(() => update({ vehicle: null, race: undefined })).not.toThrow();
    expect(nodes.get("hud")?.hidden).toBe(true);
    expect(() => update(null)).not.toThrow();
    expect(() => update(undefined)).not.toThrow();
  });

  it("unhides #hud once a race attaches", () => {
    const { nodes } = makeDoc();
    update({ vehicle: null, race: null });
    expect(nodes.get("hud")?.hidden).toBe(true);
    update({ vehicle: null, race: raceOf() }, 1 / 60);
    expect(nodes.get("hud")?.hidden).toBe(false);
  });
});

describe("hud drift popup", () => {
  it("shows DRIFT +N on a new whole-point total", () => {
    const { nodes } = makeDoc();
    showDrift(42);
    expect(nodes.get("hud-drift")?.textContent).toBe("DRIFT +42");
    expect(nodes.get("hud-drift")?.hidden).toBe(false);
  });

  it("raises the popup from a live snapshot", () => {
    const { nodes } = makeDoc();
    showDrift(0);
    updateHud(2.0);
    update(
      {
        vehicle: { speedMs: 12, currentGear: 2 },
        race: { ...raceOf(), driftTotal: 7 },
      },
      0,
    );
    expect(nodes.get("hud-drift")?.textContent).toBe("DRIFT +7");
  });

  it("fades the popup out after 1.5s", () => {
    const { nodes } = makeDoc();
    showDrift(5);
    expect(nodes.get("hud-drift")?.hidden).toBe(false);
    updateHud(1.6);
    expect(nodes.get("hud-drift")?.hidden).toBe(true);
  });
});

describe("hud defensive subscribe", () => {
  it("skips a missing emitter without throwing", () => {
    expect(() => attachRace(null)).not.toThrow();
    expect(() => attachRace(undefined)).not.toThrow();
    expect(() => attachRace({})).not.toThrow();
    expect(() => attach_race(42)).not.toThrow();
    const off = attachRace(null);
    expect(() => off()).not.toThrow();
  });

  it("links only where on() exists and returns an off closure", () => {
    const linked: string[] = [];
    const unlinked: string[] = [];
    const emitter = {
      on: (event: string): void => {
        linked.push(event);
      },
      off: (event: string): void => {
        unlinked.push(event);
      },
    };
    const off = attachRace(emitter);
    expect(linked).toContain("onRaceStateChanged");
    expect(() => off()).not.toThrow();
    expect(unlinked).toEqual(linked);
  });
});

describe("hud hygiene", () => {
  it("has no three.js or rapier imports", () => {
    const hudPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui", "hud.ts");
    const text = readFileSync(hudPath, "utf8");
    expect(text).not.toMatch(/three/);
    expect(text).not.toMatch(/rapier/i);
    expect(text).not.toMatch(/@dimforge/);
  });
});
