// Menu navigation smoke: boots the real built app, clicks through every
// shell screen, and fails on any console error or page error.
import { expect, test } from "@playwright/test";

test("menu boots clean and navigates every screen", async ({ page }) => {
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
  await expect(page.locator("#ui")).toBeVisible();
  await expect(page.locator("#screen-menu")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#scene")).toBeAttached();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.click("#btn-race");
  await expect(page.locator("#screen-event-select")).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  // The btn-event-* ids are parked hidden probe mirrors (parkMirror);
  // the visible primary carries the Event_ id and shares the handler.
  await expect(page.locator("#btn-event-harbor_sprint")).toBeAttached();
  await page.click("#Event_harbor_sprint");
  await expect(page.locator("#screen-garage")).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.click("#btn-select-sedan");
  await expect(page.locator("#screen-garage")).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.click("#screen-garage #btn-back");
  await expect(page.locator("#screen-event-select")).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.click("#screen-event-select #BackButton");
  await expect(page.locator("#screen-menu")).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.click("#btn-settings");
  await expect(page.locator("#screen-settings")).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.$eval("#vol-master", (el) => {
    const input = el as HTMLInputElement;
    input.value = "0.5";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.click("#screen-settings #btn-back");
  await expect(page.locator("#screen-menu")).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
