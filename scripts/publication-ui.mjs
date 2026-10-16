import { _electron as electron, expect } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { demoProfile, createDemoGerber } from "./demo-fixture.mjs";
await mkdir("docs/screenshots", { recursive: true });
await mkdir(".artifacts", { recursive: true });
const profile = await mkdtemp(resolve(".artifacts/publication-"));
await writeFile(resolve(profile, "settings.json"), JSON.stringify(demoProfile));
const env = { ...process.env, PCB_MARKER_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".brand")).toBeVisible();
  await app.evaluate(({ ipcMain }) => {
    for (const channel of ["printer:connect", "job:start", "job:control"]) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => {
        throw new Error("Hardware disabled during publication checks");
      });
    }
    ipcMain.removeHandler("app:check-updates");
    ipcMain.handle("app:check-updates", () => ({
      status: "current",
      version: "1.0.0",
    }));
  });
  const menu = async (name) => {
    await page.locator(".menu-anchor > button").click();
    await page
      .locator(".dropdown")
      .getByRole("button", { name, exact: true })
      .click();
  };
  await menu("О программе");
  await expect(page.locator(".about-content")).toContainText("zufari");
  await expect(page.locator(".about-content")).toContainText("1.0.0");
  await page.screenshot({ path: "docs/screenshots/about.png" });
  await menu("Проверить обновления");
  await expect(page.getByRole("status")).toContainText("последняя версия");
  for (const status of ["available", "unpublished", "error"]) {
    await app.evaluate(({ ipcMain }, status) => {
      ipcMain.removeHandler("app:check-updates");
      ipcMain.handle("app:check-updates", () => {
        if (status === "error") throw new Error("Offline");
        return { status, version: "1.1.0" };
      });
    }, status);
    await menu("Проверить обновления");
    await expect(page.getByRole("status")).toContainText(
      status === "available"
        ? "1.1.0"
        : status === "unpublished"
          ? "пока нет"
          : "Не удалось",
    );
  }
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await menu("Проверить обновления");
  await expect(page.locator(".about-page")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Не удалось");
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  const archive = await createDemoGerber();
  await app.evaluate(({ dialog }, archive) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [archive],
    });
  }, archive);
  await menu("Открыть файл");
  await expect(
    page.getByRole("button", { name: "Визуализация", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.screenshot({ path: "docs/screenshots/board.png" });
  await menu("Настройки");
  await expect(page.locator(".speed-settings input")).toHaveCount(4);
  await page.screenshot({ path: "docs/screenshots/settings.png" });
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await menu("Привязка по углам");
  await page.screenshot({ path: "docs/screenshots/corners.png" });
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page.getByRole("button", { name: "Визуализация", exact: true }).click();
  await page.locator('input[type="range"]').evaluate((el) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(el, String(Number(el.max) * 0.4));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.screenshot({ path: "docs/screenshots/preview.png" });
  expect(errors).toEqual([]);
  console.log(
    "Publication UI verified: About, all update states, demo screenshots",
  );
} finally {
  await app.close();
}
