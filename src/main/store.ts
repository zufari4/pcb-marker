import { safeStorage } from "electron";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defaults, settingsSchema } from "../shared/settings";
import type { Corners, Job, Settings } from "../shared/model";

interface StoredData {
  settings: Omit<Settings, "password">;
  encryptedPassword: string;
  corners: Corners;
  job: Job | null;
  recentFile?: string;
  hostKeys: Record<string, string>;
}
export class Store {
  settings = structuredClone(defaults);
  corners: Corners = {};
  job: Job | null = null;
  recentFile?: string;
  hostKeys: Record<string, string> = {};
  private queue = Promise.resolve();
  constructor(private directory: string) {}
  async load(legacyDirectory?: string): Promise<void> {
    try {
      const data = JSON.parse(
        await readFile(join(this.directory, "settings.json"), "utf8"),
      ) as StoredData;
      this.settings = settingsSchema.parse({
        ...data.settings,
        password: data.encryptedPassword
          ? safeStorage.decryptString(
              Buffer.from(data.encryptedPassword, "base64"),
            )
          : "",
      });
      this.corners = data.corners ?? {};
      this.job = data.job;
      this.recentFile = data.recentFile;
      this.hostKeys = data.hostKeys ?? {};
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Не удалось прочитать сохранённые настройки. Файл оставлен без изменений.",
        );
      if (legacyDirectory) await this.migrate(legacyDirectory);
    }
  }
  private async migrate(dir: string): Promise<void> {
    const read = async (file: string) => {
      try {
        return JSON.parse(await readFile(join(dir, file), "utf8"));
      } catch {
        return null;
      }
    };
    const [parameters, registration, connection] = await Promise.all([
      read("last_parameters.json"),
      read("last_parameters_corners.json"),
      read("printer_connection.json"),
    ]);
    if (parameters) {
      this.settings.drawing = {
        ...defaults.drawing,
        contactZ: Number(parameters.z),
        lift: Number(parameters.lift),
        drawSpeed: Number(parameters.speed),
        travelSpeed: Number(parameters.travel),
        frame: !!parameters.draw_border,
      };
      this.settings.strokeWidth = Number(parameters.diameter) || 0.5;
      this.settings.showTravel = parameters.show_travel !== false;
      this.recentFile = parameters.archive;
    }
    this.corners = registration?.shared ?? {};
    if (connection) {
      this.settings.host = connection.host;
      this.settings.username = connection.user;
      if (process.platform === "win32" && connection.password_protected) {
        // Legacy DPAPI migration only; secrets never appear in arguments or logs.
        const encoded = Buffer.from(
          String(connection.password_protected),
        ).toString("base64");
        const script =
          "Add-Type -AssemblyName System.Security; $v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:PCB_LEGACY_SECRET)); $b=[Convert]::FromBase64String($v); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Text.Encoding]::UTF8.GetString($p))";
        try {
          const { stdout } = await promisify(execFile)(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", script],
            {
              windowsHide: true,
              env: { ...process.env, PCB_LEGACY_SECRET: encoded },
            },
          );
          this.settings.password = stdout;
        } catch {
          /* User can enter a replacement in Settings. */
        }
      }
    }
    this.settings = settingsSchema.parse(this.settings);
    await this.save();
  }
  save(): Promise<void> {
    const { password, ...settings } = this.settings;
    if (password && !safeStorage.isEncryptionAvailable())
      return Promise.reject(
        new Error("Системное хранилище паролей недоступно."),
      );
    const data: StoredData = {
      settings,
      encryptedPassword: password
        ? safeStorage.encryptString(password).toString("base64")
        : "",
      corners: this.corners,
      job: this.job,
      recentFile: this.recentFile,
      hostKeys: this.hostKeys,
    };
    const text = JSON.stringify(data, null, 2);
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const path = join(this.directory, "settings.json");
        await writeFile(path + ".tmp", text, { mode: 0o600 });
        await rename(path + ".tmp", path);
      });
    this.queue = task;
    return task;
  }
}
