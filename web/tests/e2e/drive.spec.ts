// Drive smoke: arms harbor_sprint on the real built app, drives the
// car through the real input pipeline (no direct `vehicle.inputs`
// writes), and fails on any console error or page error.
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
        vehicle: { getState: () => { position: { x: number; y: number; z: number } } };
      };
    }).__nsr;
    nsr.startRace("harbor_sprint");
    return nsr.vehicle.getState().position;
  });

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
      };
    }).__nsr;
    nsr.input.setKey("KeyW", false);
    return nsr.vehicle.getState();
  });

  const moved = Math.hypot(end.position.x - start.x, end.position.z - start.z);
  expect(moved > 5 || end.speedMs > 1).toBe(true);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
