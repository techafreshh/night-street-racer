// Drive smoke: arms harbor_sprint on the real built app, holds full
// throttle for 10 s, and fails on any console error or page error.
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

  await page.evaluate(() => {
    const nsr = (window as unknown as {
      __nsr: { vehicle: { inputs: { throttle: number } } };
    }).__nsr;
    nsr.vehicle.inputs.throttle = 1;
  });

  await page.waitForTimeout(10_000);

  const end = await page.evaluate(() => {
    const nsr = (window as unknown as {
      __nsr: {
        vehicle: {
          getState: () => {
            position: { x: number; y: number; z: number };
            speedMs: number;
          };
        };
      };
    }).__nsr;
    return nsr.vehicle.getState();
  });

  const moved = Math.hypot(end.position.x - start.x, end.position.z - start.z);
  expect(moved > 5 || end.speedMs > 1).toBe(true);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
