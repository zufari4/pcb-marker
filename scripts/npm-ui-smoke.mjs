import { _electron as electron, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { demoProfile, createDemoGerber } from "./demo-fixture.mjs";

const packageRoot = resolve(process.argv[2]);
const requirePackage = createRequire(resolve(packageRoot, "package.json"));
// Resolve through the installed package, including Electron's first-run setup.
const executablePath = requirePackage("electron");
await mkdir(".artifacts", { recursive: true });
const profile = await mkdtemp(resolve(".artifacts/npm-ui-"));
await writeFile(resolve(profile, "settings.json"), JSON.stringify(demoProfile));
const env = { ...process.env, PCB_MARKER_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [packageRoot], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".brand")).toBeVisible();
  const archive = await createDemoGerber();
  await app.evaluate(({ dialog, ipcMain }, archive) => {
    for (const channel of ["printer:connect", "job:start", "job:control"]) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => {
        throw new Error("Hardware disabled in npm checks");
      });
    }
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [archive],
    });
  }, archive);
  await page.locator(".menu-anchor > button").click();
  await page
    .locator(".dropdown")
    .getByRole("button", { name: "Открыть файл", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Визуализация", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Визуализация", exact: true }).click();
  await expect(page.locator('input[type="range"]')).toBeVisible();
  expect(errors).toEqual([]);
  console.log("Installed npm package: UI, Gerber parsing and preview verified");
} finally {
  await app.close();
}
