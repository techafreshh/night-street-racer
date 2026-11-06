// Six-event console-clean soak (issue #229): boots the real built app,
// arms every ladder rung vs AI through window.__nsr.startRace, holds
// full throttle briefly per event, and fails on any console error or
// page error. Podiums plus lap bests go through the same probe-owned
// writers the results screen uses, so localStorage["nsr_save"]
// accumulates unlocks and bests without full-length races (CI dwell is
// seconds per event, not minutes).
import { expect, test } from "@playwright/test";

const LADDER = [
  "harbor_sprint",
  "downtown_gp",
  "neon_loop",
  "bayline_circuit",
  "alley_sprint",
  "drift_park",
];

test("six events run clean and the save accumulates unlocks plus bests", async ({
  page,
}) => {
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

  for (let i = 0; i < LADDER.length; i += 1) {
    const eventId = LADDER[i] as string;
    // Arm the rung exactly like the event flow does.
    await page.evaluate((id: string) => {
      const nsr = (window as unknown as {
        __nsr: { startRace: (eventId: string) => void };
      }).__nsr;
      nsr.startRace(id);
    }, eventId);

    // Hold full throttle briefly so physics, traffic, FX, and the HUD
    // all step live on this event's route.
    await page.evaluate(() => {
      const nsr = (window as unknown as {
        __nsr: { vehicle: { inputs: { throttle: number } } };
      }).__nsr;
      nsr.vehicle.inputs.throttle = 1;
    });
    await page.waitForTimeout(2_000);
    await page.evaluate(() => {
      const nsr = (window as unknown as {
        __nsr: { vehicle: { inputs: { throttle: number } } };
      }).__nsr;
      nsr.vehicle.inputs.throttle = 0;
    });

    // Record the podium plus a lap best through the results-screen
    // writers so the save accumulates like a completed run.
    await page.evaluate(
      ({ id, place, time }: { id: string; place: number; time: number }) => {
        const nsr = (window as unknown as {
          __nsr: {
            progression: {
              applyResult: (eventId: string, place: number) => unknown;
            };
            records: {
              saveBestIfFaster: (
                eventId: string,
                timeS: number,
                place: number,
              ) => unknown;
            };
          };
        }).__nsr;
        nsr.progression.applyResult(id, place);
        nsr.records.saveBestIfFaster(id, time, place);
      },
      { id: eventId, place: (i % 3) + 1, time: 88 + i },
    );

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  }

  const saved = await page.evaluate(() => localStorage.getItem("nsr_save"));
  expect(saved).not.toBeNull();
  const doc = JSON.parse(saved as string) as {
    progress: { unlocked_events: string[]; unlocked_cars: string[] };
    records: Record<string, { best_time_s?: number }>;
  };
  for (const eventId of LADDER) {
    expect(doc.progress.unlocked_events).toContain(eventId);
    expect(doc.records[eventId]?.best_time_s).toBeGreaterThan(0);
  }
  expect(doc.progress.unlocked_cars.length).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
