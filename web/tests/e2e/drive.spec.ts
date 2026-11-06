// Drive smoke: arms harbor_sprint on the real built app, asserts the
// player body spawns on the shared grid slot (issue #281), drives the
// car through the real input pipeline (no direct `vehicle.inputs`
// writes), asserts gate-0 crossing, and fails on any console error or
// page error.
import { expect, test } from "@playwright/test";

test("drive runs 10 s with zero console errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });

  await page.goto("/");
  await expect(page.locator("#screen-menu")).toBeVisible({ timeout: 30_000 });

  await page.waitForFunction(
    () => {
      const nsr = (window as unknown as { __nsr?: { vehicle?: unknown } }).__nsr;
      return nsr?.vehicle !== undefined && nsr.vehicle !== null;
    },
    undefined,
    { timeout: 30_000 },
  );

  const start = await page.evaluate(() => {
    const nsr = (window as unknown as {
      __nsr: {
        startRace: (eventId: string) => void;
        vehicle: {
          getState: () => { position: { x: number; y: number; z: number } };
          instance: { body: { rotation: () => { x: number; y: number; z: number; w: number } } };
        };
        race: {
          grid: {
            playerStart: { position: { x: number; y: number; z: number }; yaw: number };
          };
        };
      };
    }).__nsr;
    nsr.startRace("harbor_sprint");
    return {
      position: nsr.vehicle.getState().position,
      slot: nsr.race.grid.playerStart,
      rotation: nsr.vehicle.instance.body.rotation(),
    };
  });

  // Spawn placement: the body matches the grid slot within ±0.5 m and
  // the heading matches the slot yaw before the countdown ends.
  const gap = Math.hypot(
    start.position.x - start.slot.position.x,
    start.position.y - start.slot.position.y,
    start.position.z - start.slot.position.z,
  );
  expect(gap).toBeLessThan(0.5);
  {
    const q = start.rotation;
    const v = { x: 0, y: 0, z: -1 };
    const uv = {
      x: q.y * v.z - q.z * v.y,
      y: q.z * v.x - q.x * v.z,
      z: q.x * v.y - q.y * v.x,
    };
    const uuv = {
      x: q.y * uv.z - q.z * uv.y,
      y: q.z * uv.x - q.x * uv.z,
      z: q.x * uv.y - q.y * uv.x,
    };
    const fwd = {
      x: v.x + 2 * (q.w * uv.x + uuv.x),
      y: v.y + 2 * (q.w * uv.y + uuv.y),
      z: v.z + 2 * (q.w * uv.z + uuv.z),
    };
    const heading = Math.atan2(-fwd.x, -fwd.z);
    let diff = heading - start.slot.yaw;
    while (diff > Math.PI) {
      diff -= 2 * Math.PI;
    }
    while (diff < -Math.PI) {
      diff += 2 * Math.PI;
    }
    expect(Math.abs(diff)).toBeLessThan(0.1);
  }

  // Virtual-key leg: hold W through the shared input table so the
  // per-tick bridge copies it into the vehicle inputs.
  await page.evaluate(() => {
    const nsr = (window as unknown as {
      __nsr: { input: { setKey: (code: string, down: boolean) => void } };
    }).__nsr;
    nsr.input.setKey("KeyW", true);
  });

  await page.waitForTimeout(5_000);

  await page.evaluate(() => {
    const nsr = (window as unknown as {
      __nsr: { input: { setKey: (code: string, down: boolean) => void } };
    }).__nsr;
    nsr.input.setKey("KeyW", false);
  });

  // Real-keyboard leg: the window key handler (e.code KeyW) feeds the
  // same table, so both entry points stay regression-guarded.
  await page.keyboard.down("w");
  await page.waitForTimeout(5_000);
  await page.keyboard.up("w");

  const end = await page.evaluate(() => {
    const nsr = (window as unknown as {
      __nsr: {
        input: { setKey: (code: string, down: boolean) => void };
        vehicle: {
          getState: () => {
            position: { x: number; y: number; z: number };
            speedMs: number;
          };
        };
        race: { manager: { progresses: number[] } };
      };
    }).__nsr;
    nsr.input.setKey("KeyW", false);
    return {
      state: nsr.vehicle.getState(),
      progress: nsr.race.manager.progresses[0],
    };
  });

  const moved = Math.hypot(
    end.state.position.x - start.position.x,
    end.state.position.z - start.position.z,
  );
  expect(moved > 5 || end.state.speedMs > 1).toBe(true);
  // Gate-0 crossing: driving forward from the grid slot leaves the
  // player on the route (progress >= 0, never the -1 off-route mark).
  expect(end.progress).toBeGreaterThanOrEqual(0);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
