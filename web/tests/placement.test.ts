// Player grid-placement acceptance suite (issue #281 contract):
// placePlayerOnGrid teleports the player body onto the shared grid slot
// once per arm. Given/when/then block style with dual-spelling
// assertions, mirroring web/tests/grid.test.ts. Fake-car only: no
// rendering, no Rapier, no network.
import { describe, expect, it } from "vitest";
import { yawToQuat, type Quat, type Vec3 } from "../src/physics/vec";
import {
  armGridForEvent,
  type GridPose,
} from "../src/race/grid";
import {
  placePlayerOnGrid,
  place_player_on_grid,
} from "../src/race/placement";

type PlacedCall = { position: Vec3; quat: Quat | undefined };

function fakeCar(): { car: { placeAt: (position: Vec3, quat?: Quat) => void }; calls: PlacedCall[] } {
  const calls: PlacedCall[] = [];
  const car = {
    placeAt: (position: Vec3, quat?: Quat): void => {
      calls.push({ position, quat });
    },
  };
  return { car, calls };
}

describe("player grid placement", () => {
  it("exposes the snake_case alias on the same reference", () => {
    expect(place_player_on_grid).toBe(placePlayerOnGrid);
  });

  it("teleports the car onto the shared harbor_sprint slot", () => {
    // Given the shared grid is armed on harbor_sprint.
    const fleet = armGridForEvent("harbor_sprint", { carId: "sedan" });
    const slot = { ...fleet.playerStart };
    const { car, calls } = fakeCar();

    // When the player is placed with the default pose.
    const placed = placePlayerOnGrid(car);

    // Then the body lands exactly on the slot.
    expect(placed).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]?.position).toEqual(slot.position);
  });

  it("faces the car down the slot yaw", () => {
    // Given an armed grid with a known slot.
    const fleet = armGridForEvent("harbor_sprint", { carId: "sedan" });
    const { car, calls } = fakeCar();

    // When the player is placed.
    expect(placePlayerOnGrid(car, fleet.playerStart)).toBe(true);

    // Then the orientation matches the slot yaw.
    expect(calls[0]?.quat).toEqual(yawToQuat(fleet.playerStart.yaw));
  });

  it("returns false without throwing for a missing car or pose", () => {
    // Given an armed grid.
    armGridForEvent("harbor_sprint", { carId: "sedan" });
    const { car } = fakeCar();

    // When the car or pose is missing or unusable.
    // Then every path reports false and never throws.
    expect(placePlayerOnGrid(null)).toBe(false);
    expect(placePlayerOnGrid(undefined, null)).toBe(false);
    expect(placePlayerOnGrid(car, null)).toBe(false);
    expect(
      placePlayerOnGrid(car, { position: { x: 0, y: 0, z: 0 }, yaw: NaN }),
    ).toBe(false);
    expect(
      placePlayerOnGrid(car, {
        position: { x: Number.POSITIVE_INFINITY, y: 1, z: 0 },
        yaw: 0,
      }),
    ).toBe(false);
    expect(
      placePlayerOnGrid({ placeAt: null as unknown as () => void } as unknown as Parameters<
        typeof placePlayerOnGrid
      >[0]),
    ).toBe(false);
  });

  it("copies the slot position instead of aliasing the grid object", () => {
    // Given an armed grid.
    const fleet = armGridForEvent("harbor_sprint", { carId: "sedan" });
    const pose: GridPose = {
      position: { ...fleet.playerStart.position },
      yaw: fleet.playerStart.yaw,
    };
    const { car, calls } = fakeCar();

    // When the player is placed.
    expect(placePlayerOnGrid(car, pose)).toBe(true);

    // Then the body owns its copy: mutating it leaves the grid alone.
    expect(calls[0]?.position).toEqual(pose.position);
    expect(calls[0]?.position).not.toBe(pose.position);
    expect(calls[0]?.position).not.toBe(fleet.playerStart.position);
  });
});
