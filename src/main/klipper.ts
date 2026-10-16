import { Client, type ClientChannel } from "ssh2";
import { createHash } from "node:crypto";
import type { PrinterStatus, Settings, XYZ } from "../shared/model";

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}
export class KlipperConnection {
  private client: Client | null = null;
  private channel: ClientChannel | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private objects = new Set<string>();
  private missingCommands: string[] = [];
  sdRoot = "";
  onDisconnect: (() => void) | null = null;
  async connect(
    settings: Settings,
    hostKeys: Record<string, string>,
    saveKeys: () => Promise<void>,
  ): Promise<void> {
    this.close();
    const client = new Client();
    this.client = client;
    let firstKey = "";
    await new Promise<void>((resolve, reject) => {
      client.once("ready", resolve).once("error", reject);
      client.once("close", () => reject(new Error("Соединение закрыто.")));
      client.connect({
        host: settings.host,
        username: settings.username,
        password: settings.password,
        readyTimeout: 12000,
        keepaliveInterval: 5000,
        keepaliveCountMax: 3,
        hostHash: "sha256",
        hostVerifier: (hash: string) => {
          const known = hostKeys[settings.host];
          if (!known) firstKey = hash;
          return !known || hash === known;
        },
      });
    });
    client.on("error", () => {});
    client.on("close", () => {
      if (this.client === client) {
        this.rejectPending("Соединение с принтером потеряно.");
        this.channel = null;
        this.onDisconnect?.();
      }
    });
    if (firstKey) {
      hostKeys[settings.host] = firstKey;
      await saveKeys();
    }
    this.channel = await new Promise<ClientChannel>((resolve, reject) => {
      client.openssh_forwardOutStreamLocal(
        "/tmp/klippy_uds",
        (error, stream) => (error ? reject(error) : resolve(stream)),
      );
    }).catch(async () => {
      const ncHelp = await this.exec("nc -h 2>&1 || true");
      let command = "nc -U /tmp/klippy_uds";
      if (!/UNIX domain socket/i.test(ncHelp)) {
        const available = await this.exec("command -v socat || true");
        if (!available.trim())
          throw new Error(
            "Для доступа к Klipper нужен SSH StreamLocal, nc с поддержкой -U или socat.",
          );
        command = "socat STDIO UNIX-CONNECT:/tmp/klippy_uds";
      }
      return new Promise<ClientChannel>((resolve, reject) =>
        client.exec(command, (error, stream) =>
          error ? reject(error) : resolve(stream),
        ),
      );
    });
    this.channel.on("data", (chunk: Buffer) => this.receive(chunk));
    this.channel.on("close", () => {
      this.rejectPending("Klipper отключён.");
      this.onDisconnect?.();
    });
    const info = await this.call<{ state: string; state_message: string }>(
      "info",
    );
    if (info.state !== "ready") throw new Error(info.state_message);
    this.objects = new Set(
      (await this.call<{ objects: string[] }>("objects/list")).objects,
    );
    const commands = await this.call<Record<string, string>>("gcode/help");
    this.missingCommands = [
      "PAUSE_BASE",
      "RESUME_BASE",
      "CANCEL_PRINT_BASE",
    ].filter((name) => !(name in commands));
    const config = await this.query({ configfile: ["config"] });
    this.sdRoot = config.configfile.config.virtual_sdcard.path;
    if (!this.sdRoot.startsWith("/") || this.sdRoot.includes("\0"))
      throw new Error("Неизвестный каталог заданий Klipper.");
  }
  private receive(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    if (this.buffer.length > 16 * 1024 * 1024) {
      this.close();
      return;
    }
    for (
      let end = this.buffer.indexOf("\x03");
      end >= 0;
      end = this.buffer.indexOf("\x03")
    ) {
      const message = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      try {
        const data = JSON.parse(message),
          pending = this.pending.get(data.id);
        if (!pending) continue;
        clearTimeout(pending.timeout);
        this.pending.delete(data.id);
        if (data.error)
          pending.reject(
            new Error(data.error.message ?? JSON.stringify(data.error)),
          );
        else pending.resolve(data.result);
      } catch {
        this.rejectPending("Некорректный ответ Klipper.");
      }
    }
  }
  call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.channel)
      return Promise.reject(new Error("Принтер не подключён."));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "Принтер не ответил вовремя. Проверьте состояние перед повтором команды.",
          ),
        );
      }, 45000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.channel!.write(JSON.stringify({ id, method, params }) + "\x03");
    });
  }
  // Klipper's object dictionary is firmware-defined. Typed snapshots are built below.
  async query(objects: Record<string, string[]>): Promise<Record<string, any>> {
    return (
      await this.call<{ status: Record<string, any> }>("objects/query", {
        objects,
      })
    ).status;
  }
  script(script: string): Promise<unknown> {
    return this.call("gcode/script", { script });
  }
  async status(): Promise<PrinterStatus> {
    const objects: Record<string, string[]> = {
      print_stats: ["state", "filename", "message"],
      idle_timeout: ["state"],
      toolhead: ["homed_axes"],
      gcode_move: ["gcode_position", "position"],
      virtual_sdcard: ["progress", "file_position", "is_active"],
      extruder: ["temperature", "target"],
      heater_bed: ["temperature", "target"],
      pause_resume: ["is_paused"],
    };
    if (this.objects.has("motion_report"))
      objects.motion_report = ["live_position"];
    const s = await this.query(objects);
    const position = s.motion_report?.live_position
      ? s.motion_report.live_position
          .slice(0, 3)
          .map(
            (v: number, i: number) =>
              v + s.gcode_move.gcode_position[i] - s.gcode_move.position[i],
          )
      : s.gcode_move.gcode_position.slice(0, 3);
    return {
      connected: true,
      homed: s.toolhead.homed_axes,
      position: position as XYZ,
      positionSource: s.motion_report?.live_position ? "live" : "commanded",
      state: s.print_stats.state,
      filename: s.print_stats.filename,
      progress: Math.max(0, Math.min(1, s.virtual_sdcard.progress || 0)),
      filePosition: s.virtual_sdcard.file_position || 0,
      paused: s.pause_resume?.is_paused ?? s.print_stats.state === "paused",
      nozzle: s.extruder.temperature,
      bed: s.heater_bed.temperature,
      nozzleTarget: s.extruder.target,
      bedTarget: s.heater_bed.target,
      idle: s.idle_timeout.state,
      message: s.print_stats.message ?? "",
    };
  }
  async prepare(): Promise<PrinterStatus> {
    if (this.missingCommands.length)
      throw new Error(
        "Missing Klipper commands: " + this.missingCommands.join(", "),
      );
    assertReady(await this.status());
    await this.script("M400");
    const state = await this.status();
    assertReady(state);
    return state;
  }
  async upload(filename: string, gcode: string): Promise<void> {
    if (!/^pcb_marker_[0-9a-f]{32}\.gcode$/.test(filename))
      throw new Error("Некорректное имя задания.");
    const target = quote(`${this.sdRoot}/${filename}`);
    await this.exec(`umask 077; set -C; cat > ${target}`, gcode);
    const digest = (await this.exec(`sha256sum ${target}`))
      .trim()
      .split(/\s+/)[0];
    if (digest !== createHash("sha256").update(gcode).digest("hex"))
      throw new Error("Контрольная сумма G-code не совпала.");
  }
  exec(command: string, input?: string): Promise<string> {
    if (!this.client) return Promise.reject(new Error("SSH не подключён."));
    return new Promise((resolve, reject) => {
      this.client!.exec(command, (error, stream) => {
        if (error) return reject(error);
        let output = "",
          errors = "";
        const timer = setTimeout(() => {
          stream.close();
          reject(new Error("Истекло время команды SSH."));
        }, 45000);
        stream.on("data", (b: Buffer) => {
          output += b.toString();
        });
        stream.stderr.on("data", (b: Buffer) => {
          errors += b.toString();
        });
        stream.on("error", reject);
        stream.on("close", (code: number) => {
          clearTimeout(timer);
          if (code) reject(new Error(errors || `SSH: код ${code}`));
          else resolve(output);
        });
        stream.end(input ?? "");
      });
    });
  }
  private rejectPending(message: string) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout);
      p.reject(new Error(message));
    }
    this.pending.clear();
  }
  close(): void {
    this.rejectPending("Соединение закрыто.");
    this.channel?.close();
    this.channel = null;
    const client = this.client;
    this.client = null;
    client?.end();
    this.buffer = "";
  }
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export function assertReady(s: PrinterStatus): void {
  if (
    ["printing", "paused"].includes(s.state) ||
    s.paused ||
    s.idle === "Printing"
  )
    throw new Error("Принтер занят.");
  if (!"xyz".split("").every((axis) => s.homed.includes(axis)))
    throw new Error(
      "Нужен Home X/Y/Z. Выполните его без мешающих платы и маркера, затем проверьте привязку и Z касания.",
    );
  if (s.nozzleTarget || s.bedTarget)
    throw new Error("Сначала выключите нагрев сопла и стола.");
  if (Math.max(s.nozzle, s.bed) > 45)
    throw new Error("Дождитесь охлаждения сопла и стола ниже 45 °C.");
}
