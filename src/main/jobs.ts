import { randomUUID } from "node:crypto";
import { createProgram, assertPosition } from "../core/program";
import type {
  Board,
  Corners,
  DrawingSettings,
  Job,
  PrinterStatus,
  Side,
} from "../shared/model";
import { distance } from "../core/registration";
import { zLiftSpeedSchema, zLowerSpeedSchema } from "../shared/settings";

export interface PrinterTransport {
  prepare(): Promise<PrinterStatus>;
  status(): Promise<PrinterStatus>;
  script(script: string): Promise<unknown>;
  upload(filename: string, code: string): Promise<void>;
}
export class JobController {
  job: Job | null;
  private busy = false;
  constructor(
    private api: PrinterTransport,
    savedJob: Job | null,
    private persist: (job: Job) => Promise<void>,
    private publish: (job: Job) => void,
  ) {
    this.job = savedJob;
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("Предыдущая команда ещё выполняется.");
    this.busy = true;
    try {
      return await action();
    } finally {
      this.busy = false;
    }
  }
  private async update(job: Job): Promise<Job> {
    this.job = job;
    await this.persist(job);
    this.publish(job);
    return job;
  }
  async start(
    board: Board,
    side: Side,
    corners: Corners,
    cfg: DrawingSettings,
    dry: boolean,
  ): Promise<Job> {
    return this.exclusive(async () => {
      const state = await this.api.prepare();
      const program = createProgram(
        board,
        side,
        corners,
        cfg,
        state.position,
        dry,
      );
      const id = randomUUID().replaceAll("-", "");
      const job: Job = {
        id,
        filename: `pcb_marker_${id}.gcode`,
        boardName: board.name,
        state: "preparing",
        program,
        startedAt: new Date().toISOString(),
      };
      // Keep identity and return coordinates before any possibility of launch.
      await this.update(job);
      try {
        await this.api.upload(job.filename, program.gcode);
        const current = await this.api.prepare();
        if (distance(current.position, state.position) > 0.01)
          throw new Error(
            "Голова переместилась после подготовки. Повторите запуск.",
          );
        await this.api.script(
          `M104 S0\nM140 S0\nM220 S100\nM221 S100\nSDCARD_PRINT_FILE FILENAME=${job.filename}`,
        );
        return await this.update({ ...job, state: "running" });
      } catch (e) {
        await this.update({
          ...job,
          state: "error",
          error: (e as Error).message,
        });
        throw e;
      }
    });
  }
  async control(action: "pause" | "resume" | "stop"): Promise<Job> {
    return this.exclusive(async () => {
      const job = this.job;
      if (!job) throw new Error("Нет активного задания.");
      const zLiftSpeed = zLiftSpeedSchema.parse(job.program.zLiftSpeed);
      const zFeed = Math.round(zLiftSpeed * 60);
      let status = await this.api.status();
      if (
        status.filename !== job.filename ||
        !["printing", "paused"].includes(status.state)
      )
        throw new Error("Это задание больше не выполняется на принтере.");
      if (!"xyz".split("").every((a) => status.homed.includes(a)))
        throw new Error(
          "Координаты Home потеряны. Автоматическое движение невозможно.",
        );
      if (action === "resume") {
        if (!status.paused) throw new Error("Задание не на паузе.");
        // PAUSE_BASE captured PAUSE_STATE; RESUME_BASE restores it before SD resumes.
        // Legacy jobs retain the former resume speed. New jobs return toward
        // contact Z using the lowering speed captured when they were compiled.
        const resumeSpeed =
          job.program.zLowerSpeed === undefined
            ? 5
            : zLowerSpeedSchema.parse(job.program.zLowerSpeed);
        await this.api.script(`RESUME_BASE VELOCITY=${resumeSpeed}`);
        return this.update({ ...job, state: "running", error: undefined });
      }
      if (!status.paused) await this.api.script("PAUSE_BASE\nM400");
      else await this.api.script("M400");
      status = await this.api.status();
      if (!"xyz".split("").every((axis) => status.homed.includes(axis))) {
        if (action === "stop") await this.api.script("CANCEL_PRINT_BASE");
        throw new Error(
          "Координаты Home потеряны. Автоматическое движение невозможно.",
        );
      }
      const safeZ = Math.max(status.position[2], job.program.travelZ);
      assertPosition([status.position[0], status.position[1], safeZ]);
      if (action === "pause") {
        await this.api.script(`G90\nG1 Z${safeZ.toFixed(3)} F${zFeed}\nM400`);
        return this.update({ ...job, state: "paused", error: undefined });
      }
      try {
        const [x, y] = job.program.returnPosition;
        assertPosition([x, y, safeZ]);
        await this.api.script(
          `G90\nG1 Z${safeZ.toFixed(3)} F${zFeed}\nM400\nG1 X${x.toFixed(3)} Y${y.toFixed(3)} F1800\nM400`,
        );
      } finally {
        await this.api.script("CANCEL_PRINT_BASE");
      }
      return this.update({ ...job, state: "cancelled", error: undefined });
    });
  }
  async reconcile(status: PrinterStatus): Promise<void> {
    if (!this.job || this.busy) return;
    const job = this.job;
    if (!status.connected) {
      if (["running", "paused", "preparing"].includes(job.state))
        await this.update({ ...job, state: "disconnected" });
      return;
    }
    if (status.filename !== job.filename) {
      if (
        ["running", "paused", "disconnected", "preparing"].includes(job.state)
      )
        await this.update({
          ...job,
          state: "error",
          error: "На принтере выбрано другое задание.",
        });
      return;
    }
    const state =
      status.state === "complete"
        ? "completed"
        : status.state === "cancelled"
          ? "cancelled"
          : status.paused
            ? "paused"
            : status.state === "printing"
              ? "running"
              : status.state === "error"
                ? "error"
                : job.state;
    if (state !== job.state)
      await this.update({
        ...job,
        state,
        error: state === "error" ? status.message : undefined,
      });
  }
}
