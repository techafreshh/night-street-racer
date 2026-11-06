// Starting-grid acceptance suite (issue #225 contract): player + 0-7
// rivals from the event data on staggered slots with the same vehicle and
// tune, kinematic AI pursuit on the baked racing line, traffic active
// alongside in street events, live HUD positions, and recorded finish
// order. Given/when/then block style with dual-spelling assertions,
// mirroring web/tests/race_manager.test.ts.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STEP_DT } from "../src/core/loop";
import { getTune, validateTune } from "../src/data/tunes";
import { computeAid } from "../src/ai/rubber_band";
import { computePositions } from "../src/race/positions";
import { RaceManager } from "../src/race/manager";
import {
  GRID_BACK_SPACING,
  GRID_LATERAL,
  armGridForEvent,
  arm_grid_for_event,
  grid,
  gridStartPoses,
  grid_start_poses,
  RaceGrid,
} from "../src/race/grid";
import { Traffic } from "../src/traffic/traffic";
import {
  ensureHud,
  positionTextFor,
  position_text_for,
  update,
  type HudDocumentLike,
  type HudNodeLike,
} from "../src/ui/hud";

const gridFile = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "race",
  "grid.ts",
);

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
  return { doc, nodes };
}

// 210 fixed steps = 3.5 s > COUNTDOWN_DURATION, the acceptance clock.
function toRacing(race: RaceManager): void {
  for (let i = 0; i < 210; i++) {
    grid.advance(STEP_DT);
    race.step(STEP_DT, grid.chassisWith(undefined));
  }
}

describe("grid headcount", () => {
  it("spawns player + 5 rivals on downtown_gp for 6 racers", () => {
    const fleet = new RaceGrid();
    fleet.build("downtown_gp");
    expect(fleet.racers.length).toBe(6);
    expect(fleet.rivals.length).toBe(5);
    expect(fleet.eventId).toBe("downtown_gp");
    expect(fleet.event_id).toBe("downtown_gp");
    expect(fleet.racers[0]).toBe("player");
    expect(fleet.rivals.map((rival) => rival.id)).toEqual([
      "ai_1",
      "ai_2",
      "ai_3",
      "ai_4",
      "ai_5",
    ]);
    const field = new RaceManager();
    field.startEvent("downtown_gp");
    expect(field.racers.length).toBe(6);
    expect(field.racers.length).toBe(fleet.racers.length);
  });

  it("spawns player + 3 rivals on harbor_sprint for 4 racers", () => {
    const fleet = new RaceGrid();
    fleet.build("harbor_sprint");
    expect(fleet.racers.length).toBe(4);
    expect(fleet.rivals.length).toBe(3);
    const field = new RaceManager();
    field.startEvent("harbor_sprint");
    expect(field.racers.length).toBe(4);
    expect(field.racers.length).toBe(fleet.racers.length);
  });

  it("forces a solo field when solo is armed", () => {
    const fleet = new RaceGrid();
    fleet.build("downtown_gp", { solo: true });
    expect(fleet.racers.length).toBe(1);
    expect(fleet.rivals.length).toBe(0);
    expect(fleet.headcount).toBe(0);
  });

  it("throws Unknown event for missing ids like the manager", () => {
    expect(() => new RaceGrid().build("nope")).toThrow("Unknown event: nope");
  });

  it("pins the stagger constants and the start-pose helper", () => {
    expect(GRID_BACK_SPACING).toBe(7.0);
    expect(GRID_LATERAL).toBe(2.5);
    expect(grid_start_poses).toBe(gridStartPoses);
    expect(arm_grid_for_event).toBe(armGridForEvent);
    const poses = gridStartPoses(
      [
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: -40 },
      ],
      2,
    );
    expect(poses.length).toBe(3);
    expect(poses[0].position.x).toBeCloseTo(0, 9);
    expect(poses[1].position.z).toBeGreaterThan(poses[0].position.z);
    expect(poses[2].position.z).toBeGreaterThan(poses[1].position.z);
  });
});

describe("grid stagger", () => {
  it("offsets every rival slot so no two rivals share a pose", () => {
    const fleet = new RaceGrid();
    fleet.build("downtown_gp");
    const seen = new Set<string>();
    for (const rival of fleet.rivals) {
      const key = `${rival.position.x.toFixed(3)},${rival.position.z.toFixed(3)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    const arcs = new Set(fleet.rivals.map((rival) => rival.arc.toFixed(6)));
    expect(arcs.size).toBe(fleet.rivals.length);
  });

  it("faces every slot down the gate 0->1 direction", () => {
    const fleet = new RaceGrid();
    fleet.build("downtown_gp");
    for (const rival of fleet.rivals) {
      expect(rival.yaw).toBeCloseTo(fleet.playerStart.yaw, 9);
    }
  });
});

describe("grid tune", () => {
  it("carries the player's car id and tune snapshot on every rival", () => {
    const fleet = new RaceGrid();
    fleet.build("downtown_gp", { carId: "coupe" });
    expect(fleet.tuneId).toBe("coupe");
    expect(fleet.tune).toEqual(getTune("coupe"));
    for (const rival of fleet.rivals) {
      expect(rival.tuneId).toBe("coupe");
      expect(rival.tune_id).toBe("coupe");
      expect(validateTune(rival.tune)).toBe(true);
    }
  });

  it("falls back to the sedan tune when the car is missing", () => {
    const fleet = new RaceGrid();
    fleet.build("harbor_sprint");
    expect(fleet.tuneId).toBe("sedan");
    for (const rival of fleet.rivals) {
      expect(rival.tuneId).toBe("sedan");
      expect(validateTune(rival.tune)).toBe(true);
    }
  });
});

describe("grid motion", () => {
  it("moves every rival down the line over 5 s of advance", () => {
    const fleet = new RaceGrid();
    fleet.build("downtown_gp", { carId: "sedan" });
    const beforeArcs = fleet.rivals.map((rival) => rival.arc);
    const beforePoses = fleet.rivals.map((rival) => ({ ...rival.position }));
    for (let i = 0; i < 300; i++) {
      fleet.advance(STEP_DT);
    }
    for (let i = 0; i < fleet.rivals.length; i++) {
      const rival = fleet.rivals[i];
      const start = beforeArcs[i] ?? 0;
      const wrapped = ((rival.arc - start) % fleet.total + fleet.total) % fleet.total;
      expect(wrapped).toBeGreaterThan(1.0);
      expect(rival.speedMs).toBeGreaterThan(0);
      expect(rival.speed_ms).toBe(rival.speedMs);
      const before = beforePoses[i] ?? { x: 0, z: 0 };
      expect(
        Math.hypot(rival.position.x - before.x, rival.position.z - before.z),
      ).toBeGreaterThan(0.5);
      expect(rival.aid).toBeGreaterThanOrEqual(-3.0);
      expect(rival.aid).toBeLessThanOrEqual(3.0);
      expect(rival.inputs.throttle).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps the rubber aid to +-3 m/s", () => {
    expect(computeAid(50)).toBe(3);
    expect(computeAid(-50)).toBe(-3);
  });

  it("re-staggers without rebaking on reset", () => {
    const fleet = new RaceGrid();
    fleet.build("harbor_sprint");
    const arcs = fleet.rivals.map((rival) => rival.arc);
    for (let i = 0; i < 120; i++) {
      fleet.advance(STEP_DT);
    }
    expect(fleet.rivals[0]?.arc).not.toBeCloseTo(arcs[0] ?? 0, 3);
    const speeds = [...fleet.speeds];
    fleet.reset();
    expect(fleet.rivals.map((rival) => rival.arc)).toEqual(arcs);
    expect(fleet.speeds).toEqual(speeds);
    expect(fleet.rivals.every((rival) => rival.speedMs === 0)).toBe(true);
  });

  it("feeds an index-aligned chassis array with the player first", () => {
    const fleet = new RaceGrid();
    fleet.build("harbor_sprint");
    const chassis = fleet.chassisWith({ x: 1, y: 1, z: 2 });
    expect(chassis.length).toBe(4);
    expect(chassis[0]).toMatchObject({ x: 1, z: 2 });
    expect(fleet.chassis_with({ x: 1, z: 2 }).length).toBe(4);
  });
});

describe("grid positions and HUD", () => {
  it("keeps the live HUD position on the computePositions leader", () => {
    const race = new RaceManager();
    race.startEvent("downtown_gp");
    armGridForEvent("downtown_gp", { carId: "sedan" });
    toRacing(race);
    expect(race.getState()).toBe("racing");
    for (let i = 0; i < 300; i++) {
      grid.advance(STEP_DT);
      race.step(STEP_DT, grid.chassisWith(undefined));
    }
    const ranked = computePositions(race.progresses);
    expect(race.leader).toBe(ranked.leader);
    expect(race.positions[0]).toBe(ranked.leader);
    const pos = race.positions.indexOf(0) + 1;
    const total = race.racers.length;
    expect(positionTextFor(pos, total)).toBe(`${pos}/${total}`);
    expect(position_text_for(pos, total)).toBe(positionTextFor(pos, total));
    const { doc, nodes } = makeDoc();
    ensureHud(doc);
    update(
      {
        vehicle: { speedMs: 18, currentGear: 3 },
        race: { pos, total, lap: 1, laps: race.totalLaps, raceTime: race.raceTime },
      },
      STEP_DT,
    );
    expect(nodes.get("hud-position")?.textContent).toBe(
      positionTextFor(pos, total),
    );
  });

  it("records the full finish order once the field crosses the line", () => {
    const race = new RaceManager();
    race.startEvent("harbor_sprint");
    armGridForEvent("harbor_sprint", { carId: "sedan" });
    toRacing(race);
    const gates = race.gates;
    for (let i = 0; i < gates.length; i++) {
      const target = gates[i] ?? { x: 0, y: 1, z: 0 };
      race.step(STEP_DT, [
        { x: target.x, y: target.y, z: target.z },
        ...grid.chassisWith(undefined).slice(1),
      ]);
    }
    expect(race.getState()).toBe("finished");
    expect(race.results?.positions.length).toBe(4);
    expect(race.results?.places).toBe(race.results?.positions);
  });
});

describe("grid traffic", () => {
  it("cruises 6 active cars alongside the harbor_sprint racers", () => {
    const fleet = new RaceGrid();
    fleet.build("harbor_sprint");
    expect(fleet.racers.length).toBe(4);
    const traffic = new Traffic();
    expect(traffic.cars).toHaveLength(6);
    expect(traffic.isActive()).toBe(true);
    expect(traffic.is_active()).toBe(true);
    for (let i = 0; i < 3 * 60; i++) {
      traffic.step(STEP_DT, { x: 0, y: 0, z: 0 });
    }
    expect(traffic.cars).toHaveLength(6);
    for (const car of traffic.cars) {
      expect(car.speedMs).toBeGreaterThan(8.0);
    }
  });

  it("parks motion but keeps 6 cars for a solo build", () => {
    const fleet = new RaceGrid();
    fleet.build("downtown_gp", { solo: true });
    expect(fleet.racers.length).toBe(1);
    const traffic = new Traffic();
    for (let i = 0; i < 3 * 60; i++) {
      traffic.step(STEP_DT, { x: 0, y: 0, z: 0 });
    }
    expect(traffic.cars).toHaveLength(6);
    traffic.setActive(false);
    expect(traffic.isActive()).toBe(false);
    for (let i = 0; i < 2 * 60; i++) {
      traffic.step(STEP_DT, { x: 0, y: 0, z: 0 });
    }
    expect(traffic.cars).toHaveLength(6);
    for (const car of traffic.cars) {
      expect(car.speedMs).toBeCloseTo(0, 1);
    }
    traffic.set_active(true);
    expect(traffic.isActive()).toBe(true);
  });
});

describe("grid hygiene", () => {
  it("imports no engine, physics, or DOM modules", () => {
    const text = readFileSync(gridFile, "utf8");
    expect(text).not.toMatch(/three/i);
    expect(text).not.toMatch(/rapier/i);
    expect(text).not.toMatch(/\bdocument\b/);
    expect(text).not.toMatch(/\bwindow\b/);
    const specs = [...text.matchAll(/^\s*import[^;]*from\s+["']([^"']+)["']/gm)].map(
      (match) => match[1],
    );
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(
        [
          "../data/events",
          "../data/tunes",
          "./order",
          "../ai/racing_line",
          "../ai/ai_input",
          "../ai/rubber_band",
        ].includes(spec),
      ).toBe(true);
    }
  });
});
