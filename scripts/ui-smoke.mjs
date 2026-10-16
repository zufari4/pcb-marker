import { demoProfile, createDemoGerber } from "./demo-fixture.mjs";
import { _electron as electron, expect } from "@playwright/test";
import { resolve } from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createProgram } from "../src/core/program.ts";
await mkdir(".artifacts/screens", { recursive: true });
const profile = await mkdtemp(resolve(".artifacts/ui-run-"));
const seed = structuredClone(demoProfile);
seed.job = null;
seed.encryptedPassword = "";
seed.settings.host = "127.0.0.1";
await writeFile(resolve(profile, "settings.json"), JSON.stringify(seed));
const env = { ...process.env, PCB_MARKER_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const latest = JSON.parse(
  await readFile("release/latest-build.json", "utf8").catch(
    () => '{"executable":"release/win-unpacked/PCB Marker.exe"}',
  ),
);
const app = await electron.launch({
  ...(process.env.PCB_MARKER_PACKAGED
    ? {
        executablePath: resolve(latest.executable),
        args: [],
      }
    : { args: ["."] }),
  env,
  timeout: 30000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForFunction(() => !!window.pcb);
  await app.evaluate(({ ipcMain }) => {
    for (const channel of ["printer:connect", "job:start"]) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => {
        throw new Error("Printer disabled in UI test");
      });
    }
  });
  await page.waitForTimeout(800);
  expect(
    await page.evaluate(async () => {
      await Promise.all(
        [400, 500, 600, 700].map((weight) =>
          document.fonts.load(
            `${weight} 14px "JetBrains Mono"`,
            "Плата Board 123",
          ),
        ),
      );
      return [...document.fonts]
        .filter((font) => font.family === "JetBrains Mono")
        .every((font) => font.status === "loaded");
    }),
  ).toBe(true);
  await page.screenshot({ path: ".artifacts/screens/01-empty.png" });
  await page
    .getByRole("button", { name: /Настройки|Settings/, exact: true })
    .click();
  await expect(page.locator(".dropdown")).toBeVisible();
  await page.locator("canvas").click({ position: { x: 80, y: 80 } });
  await expect(page.locator(".dropdown")).toHaveCount(0);
  await page
    .getByRole("button", { name: /Настройки|Settings/, exact: true })
    .click();
  await page
    .getByRole("button", { name: /Настройки|Settings/, exact: true })
    .last()
    .click();
  await page.getByLabel(/Язык|Language/, { exact: true }).selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".settings-page")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Speeds", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".speed-settings input")).toHaveCount(4);
  await expect(page.getByLabel("Z lift", { exact: true })).toHaveValue("5");
  await expect(page.getByLabel("Z lowering", { exact: true })).toHaveValue("3");
  await page.getByLabel("Z lift", { exact: true }).fill("2.5");
  await page.getByLabel("Z lowering", { exact: true }).fill("0.7");
  await page.locator(".frame-setting .help-tip").hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "without touching the board",
  );
  await page.screenshot({ path: ".artifacts/screens/15-frame-help.png" });
  await page.getByRole("heading", { name: "Settings", exact: true }).hover();
  await page.screenshot({ path: ".artifacts/screens/02-settings-en.png" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const savedDrawing = await page.evaluate(
    async () => (await window.pcb.snapshot()).settings.drawing,
  );
  expect(savedDrawing.zLiftSpeed).toBe(2.5);
  expect(savedDrawing.zLowerSpeed).toBe(0.7);
  const archive = process.argv[2] ?? (await createDemoGerber());
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, archive);
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Reading Gerber|Calculating .* paths/ }),
  ).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: ".artifacts/screens/03-reading.png" });
  await expect(
    page.getByRole("button", { name: "Visualization", exact: true }),
  ).toBeEnabled({ timeout: 120000 });
  await expect(
    page.getByRole("button", { name: "Both sides", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".app-version")).toHaveText("v1.0.0");
  for (const name of ["Dry run", "Start drawing"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeDisabled();
    await button.locator("..").hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "Both layers are selected",
    );
  }
  await page.screenshot({ path: ".artifacts/screens/13-disabled-hint.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  await page.screenshot({ path: ".artifacts/screens/04-board-en.png" });
  await page.locator("canvas").hover();
  await page.mouse.wheel(0, -100);
  await expect(page.locator(".zoom-value")).toHaveText("110%");
  await page.getByRole("button", { name: "Top", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start drawing", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(page.locator(".zoom-value")).toHaveText("110%");

  await page.getByRole("button", { name: "Bottom", exact: true }).click();
  await expect(page.locator(".mode-title")).toHaveText("Board · Bottom");
  await expect(page.locator(".zoom-value")).toHaveText("110%");
  await page
    .getByRole("button", { name: "Visualization", exact: true })
    .click();
  await expect(page.locator(".mode-title")).toHaveText(
    "Visualization · Bottom",
  );
  // Measure playback with most of the route already visited, where repeatedly
  // rebuilding the entire completed path used to make animation expensive.
  await page.locator('input[type="range"]').evaluate((el) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(el, String(Number(el.max) * 0.7));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  // Flush the seek's one-time completed-path cache before measuring playback.
  await page.screenshot({ path: ".artifacts/screens/18-preview-seek.png" });
  await page.evaluate(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const lineTo = proto.lineTo,
      fillText = proto.fillText;
    window.paintStats = { lines: 0, labels: 0, frames: 0, intervals: [] };
    proto.lineTo = function (...args) {
      window.paintStats.lines++;
      return lineTo.apply(this, args);
    };
    proto.fillText = function (...args) {
      window.paintStats.labels++;
      return fillText.apply(this, args);
    };
    let last = performance.now(),
      frame;
    const tick = (now) => {
      window.paintStats.frames++;
      window.paintStats.intervals.push(now - last);
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.finishPaintStats = () => {
      cancelAnimationFrame(frame);
      proto.lineTo = lineTo;
      proto.fillText = fillText;
      return window.paintStats;
    };
  });
  await page.getByRole("button", { name: "Play preview", exact: true }).click();
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: "Pause preview", exact: true })
    .click();
  const paintStats = await page.evaluate(() => window.finishPaintStats());
  expect(paintStats.labels).toBe(0);
  expect(paintStats.lines).toBeLessThan(paintStats.frames * 20);
  const intervals = [...paintStats.intervals].sort((a, b) => a - b);
  console.log(
    "PLAYBACK",
    JSON.stringify({
      lines: paintStats.lines,
      staticLabels: paintStats.labels,
      frames: paintStats.frames,
      p95FrameMs: intervals[Math.floor(intervals.length * 0.95)],
    }),
  );
  await page.screenshot({ path: ".artifacts/screens/05-motion-en.png" });
  const zoom = page.locator(".zoom-value");
  await expect(zoom).toHaveText("100%");
  await page.locator("canvas").hover();
  await page.mouse.wheel(0, -400);
  await expect(zoom).toHaveText("110%");
  await page.mouse.wheel(0, -10);
  await expect(zoom).toHaveText("120%");
  await zoom.click();
  await page.screenshot({ path: ".artifacts/screens/11-zoom-menu.png" });
  await page.getByRole("menuitem", { name: "Reset", exact: true }).click();
  await expect(zoom).toHaveText("100%");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Corner registration", exact: true })
    .click();
  await page.screenshot({ path: ".artifacts/screens/06-binding-en.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .last()
    .click();
  await page.getByLabel("Language", { exact: true }).selectOption("ru");
  await expect(
    page.getByRole("heading", { name: "Настройки", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.screenshot({ path: ".artifacts/screens/07-board-ru.png" });
  await page.getByRole("button", { name: "Визуализация", exact: true }).click();
  await page.screenshot({ path: ".artifacts/screens/08-motion-ru.png" });
  const snapshot = await page.evaluate(() => window.pcb.snapshot());
  const program = createProgram(
    snapshot.board,
    "bottom",
    snapshot.corners,
    snapshot.settings.drawing,
    [106, 166.5, 20],
  );
  const sample = program.motions[Math.floor(program.motions.length * 0.34)];
  const simulated = {
    id: "ui-only",
    filename: "pcb_marker_ui_only.gcode",
    boardName: snapshot.board.name,
    state: "running",
    startedAt: new Date().toISOString(),
    program,
  };
  const simulatedStatus = {
    connected: true,
    homed: "xyz",
    position: sample.to,
    state: "printing",
    filename: simulated.filename,
    progress: 0.34,
    filePosition: sample.byteEnd,
    paused: false,
    nozzle: 25,
    bed: 25,
    nozzleTarget: 0,
    bedTarget: 0,
    idle: "Printing",
    message: "",
  };
  await app.evaluate(
    ({ BrowserWindow, ipcMain }, { job, status }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.send("job:changed", job);
      contents.send("printer:status", status);
      ipcMain.removeHandler("job:control");
      ipcMain.handle("job:control", (_event, action) => {
        job = {
          ...job,
          state:
            action === "pause"
              ? "paused"
              : action === "resume"
                ? "running"
                : "cancelled",
        };
        status = {
          ...status,
          state:
            action === "pause"
              ? "paused"
              : action === "resume"
                ? "printing"
                : "cancelled",
          paused: action === "pause",
          position: [
            status.position[0],
            status.position[1],
            action === "pause"
              ? job.program.travelZ
              : job.program.motions.find((m) => m.operation === "draw").to[2],
          ],
        };
        contents.send("job:changed", job);
        contents.send("printer:status", status);
        return job;
      });
    },
    { job: simulated, status: simulatedStatus },
  );
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page
    .getByRole("button", { name: "Показать задание", exact: true })
    .click();
  await expect(page.locator(".job-progress span")).toHaveText(/^\d+%$/);
  await expect(page.locator(".job-page .page-content > footer")).toHaveCount(0);
  await expect(page.locator(".job-panel .job-controls button")).toHaveCount(2);
  await expect(page.locator(".mode-title")).toHaveText("Рисование · Нижняя");
  await expect(
    page
      .locator(".job-page .page-content > footer")
      .getByRole("button", { name: "Закрыть" }),
  ).toHaveCount(0);
  await expect(page.locator(".mode-title")).toHaveText("Рисование · Нижняя");
  await page.screenshot({ path: ".artifacts/screens/09-job-ru.png" });
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "На паузе", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Продолжить", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: ".artifacts/screens/10-paused-ru.png" });
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Выполняется", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Остановлено", exact: true }),
  ).toBeVisible();
  const dryProgram = createProgram(
    snapshot.board,
    "bottom",
    snapshot.corners,
    snapshot.settings.drawing,
    [106, 166.5, 20],
    true,
  );
  await app.evaluate(
    ({ BrowserWindow }, { job, status }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.send("job:changed", job);
      contents.send("printer:status", status);
    },
    {
      job: { ...simulated, state: "running", program: dryProgram },
      status: {
        ...simulatedStatus,
        filePosition:
          dryProgram.motions[Math.floor(dryProgram.motions.length * 0.34)]
            .byteEnd,
      },
    },
  );
  await expect(page.locator(".mode-title")).toHaveText(
    "Пробный прогон · Нижняя",
  );
  await page.screenshot({ path: ".artifacts/screens/12-dry-run.png" });
  // Reproduce a buffered command on one frame edge while the live cursor is
  // already on another edge. The cursor must never become a path endpoint.
  await page.evaluate(() => {
    const ctx = document.querySelector(".job-page canvas").getContext("2d");
    const original = ctx.lineTo;
    const originalBegin = ctx.beginPath;
    const originalArc = ctx.arc;
    window.progressEndpoints = [];
    window.progressSamples = [];
    window.cursorOffsets = [];
    let paintedPoint = null;
    ctx.beginPath = function () {
      if (this.strokeStyle === "#19e2db") window.progressEndpoints = [];
      return originalBegin.call(this);
    };
    ctx.lineTo = function (x, y) {
      if (this.strokeStyle === "#19e2db") {
        window.progressEndpoints.push([x, y]);
        window.progressSamples.push([x, y]);
        paintedPoint = new DOMPoint(x, y).matrixTransform(this.getTransform());
      }
      return original.call(this, x, y);
    };
    ctx.arc = function (x, y, ...args) {
      if (this.strokeStyle === "#ffcc54" && paintedPoint) {
        const cursor = new DOMPoint(x, y).matrixTransform(this.getTransform());
        window.cursorOffsets.push(
          Math.hypot(cursor.x - paintedPoint.x, cursor.y - paintedPoint.y),
        );
      }
      return originalArc.call(this, x, y, ...args);
    };
    window.restoreProgressProbe = () => {
      ctx.lineTo = original;
      ctx.beginPath = originalBegin;
      ctx.arc = originalArc;
    };
  });
  await app.evaluate(
    ({ BrowserWindow }, { job, status }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.send("job:changed", job);
      contents.send("printer:status", status);
    },
    {
      job: {
        ...simulated,
        id: "ui-frame-progress",
        filename: "ui-frame-progress.gcode",
        program: {
          ...dryProgram,
          motions: [
            {
              from: [100, 80, 20],
              to: [100, 160, 20],
              operation: "travel",
              path: true,
              start: 0,
              end: 8,
              byteStart: 0,
              byteEnd: 10,
            },
            {
              from: [100, 160, 20],
              to: [200, 160, 20],
              operation: "travel",
              path: true,
              start: 8,
              end: 18,
              byteStart: 10,
              byteEnd: 20,
            },
            {
              from: [200, 160, 20],
              to: [200, 80, 20],
              operation: "travel",
              path: false,
              start: 18,
              end: 26,
              byteStart: 20,
              byteEnd: 30,
            },
          ],
        },
      },
      status: {
        ...simulatedStatus,
        filename: "ui-frame-progress.gcode",
        filePosition: 0,
        position: [100, 120, 19.728],
      },
    },
  );
  await expect
    .poll(() => page.evaluate(() => window.progressEndpoints))
    .toEqual([[100, 120]]);
  await expect(page.locator(".job-operation")).toContainText(
    "Проход по рисунку",
  );
  await page.evaluate(() => {
    window.progressSamples = [];
  });
  await app.evaluate(
    ({ BrowserWindow }, status) => {
      BrowserWindow.getAllWindows()[0].webContents.send(
        "printer:status",
        status,
      );
    },
    {
      ...simulatedStatus,
      filename: "ui-frame-progress.gcode",
      filePosition: 10,
      position: [150, 160, 20.153],
    },
  );
  await expect
    .poll(() => page.evaluate(() => window.progressEndpoints))
    .toEqual([[150, 160]]);
  const samples = await page.evaluate(() => window.progressSamples);
  expect(
    await page.evaluate(() => Math.max(...window.cursorOffsets)),
  ).toBeLessThan(0.001);
  if (
    samples.length < 3 ||
    !samples.some(([x, y]) => x > 100 && x < 150 && y === 160)
  )
    throw new Error(
      `Expected intermediate animation frames: ${JSON.stringify(samples)}`,
    );
  if (
    samples.some(
      ([x, y]) =>
        !(
          (x === 100 && y >= 120 && y <= 160) ||
          (y === 160 && x >= 100 && x <= 150)
        ),
    )
  )
    throw new Error("Interpolation cut across a corner or overshot telemetry");
  await page.screenshot({ path: ".artifacts/screens/14-frame-progress.png" });
  await app.evaluate(
    ({ BrowserWindow }, status) => {
      BrowserWindow.getAllWindows()[0].webContents.send(
        "printer:status",
        status,
      );
    },
    {
      ...simulatedStatus,
      filename: "ui-frame-progress.gcode",
      filePosition: 20,
      position: [200, 120, 20],
    },
  );
  await expect(page.locator(".job-operation")).toContainText("Перемещение");
  await page.evaluate(() => window.restoreProgressProbe());
  await app.evaluate(
    ({ BrowserWindow }, job) =>
      BrowserWindow.getAllWindows()[0].webContents.send("job:changed", {
        ...job,
        state: "cancelled",
      }),
    simulated,
  );
  await page
    .locator(".job-page")
    .getByRole("button", { name: "Назад", exact: true })
    .click();
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("board:open");
    ipcMain.handle("board:open", () => {
      throw new Error("UI timer test");
    });
  });
  await page.locator(".menu-anchor > button").click();
  await page
    .locator(".dropdown")
    .getByRole("button", { name: "Открыть файл", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("UI timer test");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 17000 });
  // Keep the launch request pending: the page must open before it resolves.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("job:start");
    ipcMain.handle(
      "job:start",
      () =>
        new Promise((_resolve, reject) => {
          globalThis.rejectUiLaunch = () =>
            reject(new Error("UI launch check"));
        }),
    );
  });
  await page
    .getByRole("button", { name: "Пробный прогон", exact: true })
    .click();
  await expect(page.locator(".job-starting-page")).toBeVisible({
    timeout: 1000,
  });
  await expect(page.locator(".job-starting-page")).toContainText("Подготовка");
  await app.evaluate(() => globalThis.rejectUiLaunch());
  await expect(page.locator(".job-starting-page")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("UI launch check");
  console.log(
    JSON.stringify({
      errors,
      language: snapshot.settings.language,
      hasPassword: !!snapshot.settings.password,
      cornerCount: Object.keys(snapshot.corners).length,
      board: snapshot.board?.name,
      bounds: snapshot.board?.bounds,
    }),
  );
  if (errors.length) throw new Error(errors.join("\n"));
} catch (error) {
  console.error("UI_TEST_FAILURE", error);
  const page = app.windows().find((p) => !p.isClosed());
  if (!page) throw error;
  await page.screenshot({ path: ".artifacts/screens/failure.png" });
  console.log("PAGE_ERRORS", errors);
  console.log("TOAST", await page.locator(".error-toast").allTextContents());
  throw error;
} finally {
  await app.close();
}
