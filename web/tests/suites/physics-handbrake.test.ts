// Physics handbrake band: held rear grip is 0.3 nominal of full.
// Suite asserts the ratio stays under 0.35 with retune slack.
import { describe, expect, it } from "vitest";
import { computeLateralForce } from "../../src/vehicles/vehicle";

describe("physics handbrake band", () => {
  it("holds rear lateral grip under 0.35 of full", () => {
    const full = computeLateralForce(0.3, 3000.0, 1.0, 12000.0, 1.0, 1.0);
    expect(Math.abs(full)).toBeGreaterThan(1.0);
    const held = computeLateralForce(0.3, 3000.0, 1.0, 12000.0, 1.0, 0.1);
    expect(Math.abs(held / full)).toBeLessThan(0.35);
  });
});
