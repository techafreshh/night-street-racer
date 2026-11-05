// Race-manager acceptance suite (issue #217 contract): countdown 3-2-1-GO,
// pause-gated steps, directed gate advance, lap counting, live positions,
// wrong-way flag, and finish results. Given/when/then block style with
// dual-spelling assertions, mirroring web/tests/race.test.ts.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STEP_DT } from "../src/core/loop";
import { nextIndex } from "../src/race/order";
import {
  GATE_RADIUS_DEFAULT,
  gateRadiusOf,
  gate_radius_of,
  isInsideGate,
  is_inside_gate,
  RaceRoute,
} from "../src/race/route";
import {
  COUNTDOWN_DURATION,
  getState,
  get_state,
  manager,
  RaceManager,
  reset_race,
  resetRace,
  set_paused,
  setPaused,
  start_event,
  startEvent,
  step,
} from "../src/race/manager";

const raceDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "race");

function gate(x: number, z: number): { x: number; y: number; z: number } {
  return { x, y: 1, z };
}

// 210 fixed steps = 3.5 s > COUNTDOWN_DURATION, the acceptance clock.
function toRacing(race: RaceManager): void {
  for (let i = 0; i < 210; i++) {
    race.step(STEP_DT);
  }
}

describe("countdown", () => {
  it("pins the 3s countdown so 3.5s unpaused reads racing", () => {
    expect(COUNTDOWN_DURATION).toBe(3.0);
    const race = new RaceManager();
    expect(race.getState()).toBe("idle");
    expect(race.get_state()).toBe("idle");
    race.startEvent("downtown_gp");
    expect(race.getState()).toBe("countdown");
    expect(race.eventId).toBe("downtown_gp");
    expect(race.event_id).toBe("downtown_gp");
    expect(race.totalLaps).toBe(3);
    expect(race.total_laps).toBe(3);
    expect(race.racers).toEqual([
      "player",
      "ai_1",
      "ai_2",
      "ai_3",
      "ai_4",
      "ai_5",
    ]);
    toRacing(race);
    expect(race.getState()).toBe("racing");
    expect(race.get_state()).toBe("racing");
  });

  it("freezes the countdown while paused", () => {
    const race = new RaceManager();
    race.startEvent("downtown_gp");
    race.setPaused(true);
    expect(race.isPaused()).toBe(true);
    expect(race.is_paused()).toBe(true);
    for (let i = 0; i < 60; i++) {
      race.step(STEP_DT);
    }
    expect(race.countdownLeft).toBe(COUNTDOWN_DURATION);
    expect(race.countdown_left).toBe(COUNTDOWN_DURATION);
    expect(race.getState()).toBe("countdown");
    race.set_paused(false);
    expect(race.isPaused()).toBe(false);
    race.step(STEP_DT);
    expect(race.countdownLeft).toBeLessThan(COUNTDOWN_DURATION);
    race.pause(true);
    expect(race.isPaused()).toBe(true);
    race.pause(false);
    expect(race.isPaused()).toBe(false);
  });
});

describe("gate advance", () => {
  it("increments gateIndex by 1 inside the next gate radius", () => {
    const race = new RaceManager();
    race.startEvent("downtown_gp");
    toRacing(race);
    const before = race.gateIndex;
    const next = nextIndex(before, race.event);
    expect(next).toBeGreaterThanOrEqual(0);
    const target = race.gates[next];
    race.step(STEP_DT, { x: target.x, y: target.y, z: target.z });
    expect(race.gateIndex).toBe(before + 1);
    expect(race.gate_index).toBe(before + 1);
  });

  it("accepts array and id-mapped chassis spellings", () => {
    const race = new RaceManager();
    race.startEvent("downtown_gp");
    toRacing(race);
    const first = race.gateIndex;
    const gates = race.gates;
    race.step(STEP_DT, [{ x: gates[1].x, y: gates[1].y, z: gates[1].z }]);
    expect(race.gateIndex).toBe(first + 1);
    race.step(STEP_DT, {
      player: { x: gates[2].x, y: gates[2].y, z: gates[2].z },
    });
    expect(race.gateIndex).toBe(first + 2);
  });
});

describe("laps and finish", () => {
  it("reaches finished over the full downtown ladder with 6 results", () => {
    const race = new RaceManager();
    race.startEvent("downtown_gp");
    toRacing(race);
    const gates = race.gates;
    expect(gates.length).toBe(8);
    for (let lap = 0; lap < 3; lap++) {
      for (let i = 0; i < gates.length; i++) {
        race.step(STEP_DT, [{ x: gates[i].x, y: gates[i].y, z: gates[i].z }]);
      }
    }
    expect(race.getState()).toBe("finished");
    expect(race.currentLap).toBe(3);
    expect(race.current_lap).toBe(3);
    expect(race.results).not.toBeNull();
    expect(race.results?.positions.length).toBe(race.racers.length);
    expect(race.results?.positions.length).toBe(6);
    expect(race.results?.places).toBe(race.results?.positions);
    expect(race.results?.eventId).toBe("downtown_gp");
    expect(race.results?.raceTime).toBeGreaterThan(0);
    expect(race.results?.laps).toBe(3);
    expect(race.positions[0]).toBe(0);
    expect(race.leader).toBe(0);
    race.step(STEP_DT, [{ x: gates[0].x, y: gates[0].y, z: gates[0].z }]);
    expect(race.getState()).toBe("finished");
  });

  it("finishes a sprint in 1 lap with the field stamped", () => {
    const race = new RaceManager();
    race.start_event("harbor_sprint");
    expect(race.totalLaps).toBe(1);
    expect(race.racers.length).toBe(4);
    toRacing(race);
    const gates = race.gates;
    for (let i = 0; i < gates.length; i++) {
      race.step(STEP_DT, { x: gates[i].x, y: gates[i].y, z: gates[i].z });
    }
    expect(race.getState()).toBe("finished");
    expect(race.currentLap).toBe(1);
    expect(race.results?.positions.length).toBe(4);
  });

  it("re-arms the countdown on reset without dropping the field", () => {
    const race = new RaceManager();
    race.startEvent("downtown_gp");
    toRacing(race);
    race.resetRace();
    expect(race.getState()).toBe("countdown");
    expect(race.gateIndex).toBe(-1);
    expect(race.raceTime).toBe(0);
    expect(race.results).toBeNull();
    expect(race.racers.length).toBe(6);
    expect(race.eventId).toBe("downtown_gp");
    race.reset_race();
    expect(race.getState()).toBe("countdown");
  });
});

describe("wrong way", () => {
  it("flags a skipped gate and clears on the expected one", () => {
    const race = new RaceManager();
    race.startEvent("downtown_gp");
    toRacing(race);
    expect(race.wrongWay).toBe(false);
    const skip = race.gates[2];
    race.step(STEP_DT, { x: skip.x, z: skip.z });
    expect(race.gateIndex).toBe(0);
    expect(race.wrongWay).toBe(true);
    expect(race.wrong_way).toBe(true);
    const expected = race.gates[1];
    race.step(STEP_DT, { x: expected.x, z: expected.z });
    expect(race.gateIndex).toBe(1);
    expect(race.wrongWay).toBe(false);
  });

  it("flags driving away from the next gate when a velocity is supplied", () => {
    const race = new RaceManager();
    race.startEvent("downtown_gp");
    toRacing(race);
    const from = race.gates[0];
    const to = race.gates[1];
    const dx = from.x - to.x;
    const dz = from.z - to.z;
    const len = Math.hypot(dx, dz);
    race.step(STEP_DT, undefined, {
      x: (dx / len) * 5,
      z: (dz / len) * 5,
    });
    expect(race.wrongWay).toBe(true);
    race.step(STEP_DT, undefined, {
      x: (-dx / len) * 5,
      z: (-dz / len) * 5,
    });
    expect(race.wrongWay).toBe(false);
  });
});

describe("route tracker", () => {
  it("advances in order, wraps circuits, and finishes sprints", () => {
    const circuit = {
      kind: "circuit",
      laps: 2,
      opponents: 1,
      reward: 100,
      mode: "race",
      checkpoints: [gate(0, 0), gate(10, 0), gate(10, 10), gate(0, 10)],
      checkpoint_radius: 10.0,
    };
    const route = new RaceRoute(circuit);
    expect(route.gateCount()).toBe(4);
    expect(route.gate_count()).toBe(4);
    expect(route.gateAt(0)).toEqual(gate(0, 0));
    expect(route.gate_at(9)).toBeNull();
    expect(route.registerHit(2)).toBe(false);
    expect(route.wrongWay).toBe(true);
    expect(route.wrong_way).toBe(true);
    expect(route.registerHit(0)).toBe(true);
    expect(route.wrongWay).toBe(false);
    route.register_hit(1);
    route.register_hit(2);
    route.register_hit(3);
    expect(route.currentLap).toBe(1);
    expect(route.current_lap).toBe(1);
    expect(route.finished).toBe(false);
    route.registerHit(0);
    route.registerHit(1);
    route.registerHit(2);
    route.registerHit(3);
    expect(route.currentLap).toBe(2);
    expect(route.finished).toBe(true);
    expect(route.registerHit(0)).toBe(false);
    route.reset_race();
    expect(route.currentIndex).toBe(-1);
    expect(route.currentLap).toBe(0);
    expect(route.wrongWay).toBe(false);
    expect(route.finished).toBe(false);
  });
});

describe("proximity and radius", () => {
  it("ignores Y and defaults the radius to 10", () => {
    expect(GATE_RADIUS_DEFAULT).toBe(10.0);
    expect(gateRadiusOf({})).toBe(10.0);
    expect(gate_radius_of({})).toBe(10.0);
    expect(gateRadiusOf({ checkpoint_radius: 12 })).toBe(12);
    expect(gateRadiusOf({ radius: 8 })).toBe(8);
    expect(isInsideGate({ x: 0, y: 999, z: 0 }, { x: 0, y: 1, z: 0 }, 10)).toBe(
      true,
    );
    expect(is_inside_gate({ x: 10, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, 10)).toBe(
      true,
    );
    expect(isInsideGate({ x: 10.001, y: 1, z: 0 }, gate(0, 0), 10)).toBe(false);
    const race = new RaceManager();
    race.startEvent("downtown_gp");
    expect(race.radius).toBe(10);
  });
});

describe("unknown event", () => {
  it("throws Unknown event for missing ids", () => {
    expect(() => new RaceManager().startEvent("nope")).toThrow(
      "Unknown event: nope",
    );
  });
});

describe("singleton spellings", () => {
  it("exposes the shared manager through module functions", () => {
    expect(manager).toBeInstanceOf(RaceManager);
    expect(start_event).toBe(startEvent);
    expect(get_state).toBe(getState);
    expect(set_paused).toBe(setPaused);
    expect(reset_race).toBe(resetRace);
    expect(is_inside_gate).toBe(isInsideGate);
    expect(gate_radius_of).toBe(gateRadiusOf);
    startEvent("downtown_gp");
    for (let i = 0; i < 210; i++) {
      step(STEP_DT);
    }
    expect(getState()).toBe("racing");
    expect(manager.getState()).toBe("racing");
    setPaused(true);
    expect(manager.isPaused()).toBe(true);
    setPaused(false);
    resetRace();
    expect(manager.getState()).toBe("countdown");
  });
});

describe("race hygiene", () => {
  it("keeps route and manager free of rendering and physics imports", () => {
    const allowed = new Set([
      "../data/events",
      "./order",
      "./positions",
      "./route",
    ]);
    for (const file of ["route.ts", "manager.ts"]) {
      const text = readFileSync(join(raceDir, file), "utf8");
      expect(text).not.toMatch(/three/i);
      expect(text).not.toMatch(/rapier/i);
      expect(text).not.toMatch(/\bdocument\b/);
      expect(text).not.toMatch(/\bwindow\b/);
      const specs = [...text.matchAll(/^\s*import[^;]*from\s+["']([^"']+)["']/gm)].map(
        (match) => match[1],
      );
      for (const spec of specs) {
        expect(allowed.has(spec)).toBe(true);
      }
    }
  });
});
