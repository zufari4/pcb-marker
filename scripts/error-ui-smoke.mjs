import { demoProfile, createDemoGerber } from "./demo-fixture.mjs";
import { _electron as electron, expect } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const seed = structuredClone(demoProfile);
seed.encryptedPassword = "";
seed.settings.host = "127.0.0.1";
seed.settings.language = "ru";
seed.job = null;
delete seed.recentFile;

async function launch(data, args = []) {
  await mkdir(".artifacts", { recursive: true });
  const profile = await mkdtemp(resolve(".artifacts/error-ui-"));
  await writeFile(
    resolve(profile, "settings.json"),
    typeof data === "string" ? data : JSON.stringify(data),
  );
  const env = { ...process.env, PCB_MARKER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [".", ...args], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.pcb);
  return { app, page };
}

let current = await launch("{invalid-json");
try {
  await expect(current.page.locator(".startup-error")).toBeVisible();
  await expect(current.page.getByRole("alert")).toContainText("настройки");
  await current.page.screenshot({
    path: ".artifacts/screens/16-startup-error.png",
  });
} finally {
  await current.app.close();
}

current = await launch(seed, [resolve(".artifacts/missing-board.zip")]);
try {
  await expect(current.page.locator(".error-toast")).toContainText(
    /ENOENT|missing-board/,
  );
} finally {
  await current.app.close();
}

const job = {
  id: "ui-close-only",
  filename: "ui-close-only.gcode",
  boardName: "UI check",
  state: "running",
  startedAt: new Date().toISOString(),
  program: {
    gcode: "",
    motions: [],
    duration: 0,
    returnPosition: [0, 0, 20],
    travelZ: 20,
    side: "top",
    dry: true,
  },
};
current = await launch({ ...seed, job });
const closingProcess = current.app.process();
try {
  await current.page.evaluate(() => window.pcb.window("close"));
  await expect(current.page.getByRole("alertdialog")).toContainText(
    "Задание продолжится на принтере",
  );
  await current.page
    .getByRole("button", { name: "Остаться", exact: true })
    .click();
  await expect(current.page.getByRole("alertdialog")).toHaveCount(0);
  await current.page.evaluate(() => window.pcb.window("close"));
  await expect(current.page.getByRole("alertdialog")).toBeVisible();
  await current.page.screenshot({
    path: ".artifacts/screens/17-close-confirmation.png",
  });
  const closed = current.app.waitForEvent("close");
  await current.page.evaluate(() => window.pcb.window("confirm-close"));
  await closed;
} finally {
  if (closingProcess.exitCode === null) await current.app.close();
}
console.log(
  "PASS: startup errors, Gerber errors and active-job close confirmation stay inside the application.",
);
