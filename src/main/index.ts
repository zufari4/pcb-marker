import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { project } from "../shared/project";
import { checkUpdates } from "./updates";
import { Worker } from "node:worker_threads";
import { dirname, join, resolve } from "node:path";
import { access, writeFile } from "node:fs/promises";
import { z } from "zod";
import { Store } from "./store";
import { KlipperConnection } from "./klipper";
import { JobController } from "./jobs";
import { createProgram } from "../core/program";
import { hasConnectionSettings, settingsSchema } from "../shared/settings";
import { localizeMessage, resolveLanguage } from "../shared/messages";
import type { AppSnapshot, Board, PrinterStatus } from "../shared/model";

app.setAppUserModelId("app.pcbmarker.desktop");

let window: BrowserWindow, store: Store, jobs: JobController;
const api = new KlipperConnection();
let board: Board | null = null,
  printer: PrinterStatus | null = null,
  worker: Worker | null = null;
let cancelWorker: (() => void) | null = null,
  polling = false,
  connecting = false;
if (process.env.PCB_MARKER_DATA_DIR)
  app.setPath("userData", resolve(process.env.PCB_MARKER_DATA_DIR));
const send = (channel: string, data: unknown) => {
  if (window && !window.isDestroyed()) window.webContents.send(channel, data);
};
let connectionAttempt: Promise<PrinterStatus> | null = null;
let allowClose = false;
const sideSchema = z.enum(["top", "bottom"]);
const active = () =>
  jobs?.job &&
  ["running", "paused", "preparing", "disconnected"].includes(jobs.job.state);

ipcMain.on("window", (event, action) => {
  if (!window || event.sender !== window.webContents) return;
  if (action === "minimize") window.minimize();
  if (action === "maximize")
    window.isMaximized() ? window.unmaximize() : window.maximize();
  if (action === "confirm-close") allowClose = true;
  if (action === "close" || action === "confirm-close") window.close();
});

async function loadBoard(path: string): Promise<Board | null> {
  if (!/\.zip$/i.test(path)) throw new Error("Выберите Gerber ZIP.");
  if (active()) throw new Error("Дождитесь завершения задания.");
  cancelWorker?.();
  send("board:progress", { stage: "Чтение Gerber…", busy: true });
  return new Promise((done, reject) => {
    const current = new Worker(join(__dirname, "geometry-worker.cjs"), {
      workerData: { path },
      resourceLimits: { maxOldGenerationSizeMb: 768 },
    });
    worker = current;
    let settled = false,
      receivedBoard = false;
    const finish = (error?: Error, result: Board | null = null) => {
      if (settled) return;
      settled = true;
      if (worker === current) {
        worker = null;
        cancelWorker = null;
        send("board:progress", { stage: "", busy: false });
      }
      void current.terminate();
      if (error) reject(error);
      else done(result);
    };
    cancelWorker = () => finish();
    current.on("message", async (message) => {
      if (settled) return;
      if (message.stage)
        send("board:progress", { stage: message.stage, busy: true });
      if (message.error) finish(new Error(message.error));
      if (message.board) {
        receivedBoard = true;
        try {
          store.recentFile = path;
          await store.save();
          if (settled) return;
          board = message.board;
          send("board:changed", board);
          finish(undefined, board);
        } catch (e) {
          finish(e as Error);
        }
      }
    });
    current.on("error", (error) => finish(error));
    current.on("exit", (code) => {
      if (!settled && !receivedBoard)
        finish(new Error(`Обработка Gerber прервана (${code}).`));
    });
  });
}
/** Shared by startup and the Connect button; concurrent callers reuse one SSH attempt. */
function connectPrinter(): Promise<PrinterStatus> {
  if (connectionAttempt) return connectionAttempt;
  connecting = true;
  printer = {
    connected: false,
    state: "connecting",
    message: "",
    homed: "",
    position: [0, 0, 0],
    filename: "",
    progress: 0,
    filePosition: 0,
    paused: false,
    nozzle: 0,
    bed: 0,
    nozzleTarget: 0,
    bedTarget: 0,
    idle: "",
  };
  send("printer:status", printer);
  connectionAttempt = (async () => {
    try {
      await api.connect(store.settings, store.hostKeys, () => store.save());
      printer = await api.status();
      send("printer:status", printer);
      await jobs.reconcile(printer);
      return printer;
    } catch (error) {
      api.close();
      printer = {
        ...printer!,
        connected: false,
        state: "connection_error",
        message: localizeMessage(
          (error as Error).message,
          resolveLanguage(store.settings.language, app.getLocale()),
        ),
      };
      send("printer:status", printer);
      throw error;
    } finally {
      connecting = false;
      connectionAttempt = null;
    }
  })();
  return connectionAttempt;
}

function registerIpc(): void {
  const handle = (channel: string, action: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Недопустимый источник команды.");
      try {
        return await action(...args);
      } catch (error) {
        const language = resolveLanguage(
          store.settings.language,
          app.getLocale(),
        );
        if (error instanceof z.ZodError)
          throw new Error(
            language === "ru"
              ? "Проверьте значения настроек: " +
                  error.issues.map((i) => i.path.join(".")).join(", ")
              : "Check settings: " +
                  error.issues.map((i) => i.path.join(".")).join(", "),
          );
        throw new Error(localizeMessage((error as Error).message, language));
      }
    });
  handle("snapshot", (): AppSnapshot => ({
    settings: store.settings,
    systemLocale: app.getLocale(),
    corners: store.corners,
    board,
    printer,
    job: jobs.job,
    recentFile: store.recentFile,
  }));
  handle("app:check-updates", () => checkUpdates(app.getVersion()));
  handle("app:open-project", (page) =>
    shell.openExternal(
      project[z.enum(["repository", "releases", "issues"]).parse(page)],
    ),
  );
  handle("settings:save", async (value) => {
    const next = settingsSchema.parse(value);
    if (active()) throw new Error("Настройки недоступны во время задания.");
    const connectionChanged = ["host", "username", "password"].some(
      (k) =>
        next[k as keyof typeof next] !== store.settings[k as keyof typeof next],
    );
    store.settings = next;
    await store.save();
    if (connectionChanged) {
      api.close();
      // Finish a startup attempt before a settings-driven reconnect can begin.
      await connectionAttempt?.catch(() => {});
      if (printer) {
        printer = { ...printer, connected: false };
        send("printer:status", printer);
      }
    }
    return next;
  });
  handle("board:open", async () => {
    const result = await dialog.showOpenDialog(window, {
      filters: [{ name: "Gerber ZIP", extensions: ["zip"] }],
      properties: ["openFile"],
    });
    return result.canceled ? null : loadBoard(result.filePaths[0]);
  });
  handle("board:drop", (path) => loadBoard(z.string().min(1).parse(path)));
  handle("board:cancel", () => {
    cancelWorker?.();
  });
  handle("printer:connect", connectPrinter);
  handle("corners:capture", async (value) => {
    if (active()) throw new Error("Сначала завершите задание.");
    const key = z.enum(["fl", "fr", "rr", "rl"]).parse(value);
    const state = await api.prepare();
    store.corners = { ...store.corners, [key]: state.position.slice(0, 2) };
    await store.save();
    return store.corners;
  });
  handle("corners:reset", async () => {
    if (active()) throw new Error("Сначала завершите задание.");
    store.corners = {};
    await store.save();
    return store.corners;
  });
  handle("job:start", (side, dry) => {
    if (!board || worker) throw new Error("Сначала откройте Gerber.");
    return jobs.start(
      board,
      sideSchema.parse(side),
      store.corners,
      store.settings.drawing,
      z.boolean().parse(dry),
    );
  });
  handle("job:control", (action) =>
    jobs.control(z.enum(["pause", "resume", "stop"]).parse(action)),
  );
  handle("gcode:export", async (side, dry) => {
    if (!board) throw new Error("Сначала откройте Gerber.");
    const state = await api.prepare();
    const program = createProgram(
      board,
      sideSchema.parse(side),
      store.corners,
      store.settings.drawing,
      state.position,
      z.boolean().parse(dry),
    );
    const result = await dialog.showSaveDialog(window, {
      defaultPath: `${side}_${dry ? "dry_run" : "draw"}.gcode`,
      filters: [{ name: "G-code", extensions: ["gcode"] }],
    });
    if (!result.filePath) return null;
    await writeFile(result.filePath, program.gcode);
    return result.filePath;
  });
}
function createWindow() {
  const result = new BrowserWindow({
    width: 1450,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    backgroundColor: "#0c171e",
    title: "PCB Marker",
    icon: join(__dirname, "../assets/icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  result.setMenu(null);
  result.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  result.webContents.on("will-navigate", (event) => event.preventDefault());
  return result;
}
async function boot() {
  store = new Store(app.getPath("userData"));
  let legacyDirectory: string | undefined;
  let parent = app.isPackaged ? dirname(process.execPath) : app.getAppPath();
  for (let i = 0; i < 5; i++, parent = dirname(parent)) {
    const candidate = join(parent, "outputs");
    try {
      await access(join(candidate, "last_parameters.json"));
      legacyDirectory = candidate;
      break;
    } catch {
      /* Check the next ancestor. */
    }
  }
  await store.load(legacyDirectory);
  jobs = new JobController(
    api,
    store.job,
    async (job) => {
      store.job = job;
      await store.save();
    },
    (job) => send("job:changed", job),
  );
  window = createWindow();
  registerIpc();
  api.onDisconnect = () => {
    if (printer) {
      printer = { ...printer, connected: false };
      send("printer:status", printer);
      void jobs.reconcile(printer).catch(() => {});
    }
  };
  const timer = setInterval(async () => {
    if (polling || connecting || !printer?.connected) return;
    polling = true;
    try {
      printer = await api.status();
      send("printer:status", printer);
      await jobs.reconcile(printer);
    } catch {
      api.onDisconnect?.();
    } finally {
      polling = false;
    }
  }, 500);
  window.on("close", (event) => {
    if (active() && !allowClose) {
      event.preventDefault();
      send("window:close-request", undefined);
    }
  });
  window.on("closed", () => {
    clearInterval(timer);
    cancelWorker?.();
    api.close();
  });
  await window.loadFile(join(__dirname, "../renderer/index.html"));
  if (hasConnectionSettings(store.settings)) {
    // Connection failure stays in the status indicator and never blocks opening files.
    void connectPrinter().catch(() => {});
  }
  const openArgument = process.argv.find((a) => /\.zip$/i.test(a));
  if (openArgument) {
    try {
      await loadBoard(resolve(openArgument));
    } catch (error) {
      send("app:error", (error as Error).message);
    }
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      window.restore();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(boot)
    .catch(async (error) => {
      allowClose = true;
      if (!window || window.isDestroyed()) window = createWindow();
      await window
        .loadFile(join(__dirname, "../renderer/index.html"), {
          query: { startupError: String(error.message ?? error) },
        })
        .catch(() => app.quit());
    });
  app.on("window-all-closed", () => app.quit());
}
