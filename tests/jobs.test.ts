import { test } from "node:test";
import assert from "node:assert/strict";
import { JobController, type PrinterTransport } from "../src/main/jobs";
import { assertReady } from "../src/main/klipper";
import type { Job, PrinterStatus } from "../src/shared/model";
const status: PrinterStatus = {
  connected: true,
  homed: "xyz",
  position: [100, 100, 16],
  state: "printing",
  filename: "pcb_marker_abc.gcode",
  progress: 0.34,
  filePosition: 100,
  paused: false,
  nozzle: 25,
  bed: 25,
  nozzleTarget: 0,
  bedTarget: 0,
  idle: "Printing",
  message: "",
};
function setup() {
  let state = structuredClone(status);
  const scripts: string[] = [];
  const api: PrinterTransport = {
    status: async () => state,
    prepare: async () => state,
    upload: async () => {},
    script: async (script) => {
      scripts.push(script);
      if (script.includes("PAUSE_BASE"))
        state = { ...state, paused: true, state: "paused" };
    },
  };
  const job: Job = {
    id: "abc",
    filename: status.filename,
    boardName: "test",
    state: "running",
    startedAt: "",
    program: {
      gcode: "",
      motions: [],
      duration: 0,
      returnPosition: [80, 90, 18],
      travelZ: 18,
      side: "top",
      dry: false,
    },
  };
  const controller = new JobController(
    api,
    job,
    async () => {},
    () => {},
  );
  return {
    controller,
    scripts,
    setState: (next: Partial<PrinterStatus>) => {
      state = { ...state, ...next };
    },
  };
}
test("pause raises, resume delegates to saved Klipper pause state, stop returns without M84", async () => {
  const { controller, scripts } = setup();
  await controller.control("pause");
  assert.equal(controller.job?.state, "paused");
  assert.ok(scripts[0].includes("PAUSE_BASE"));
  assert.ok(scripts[1].includes("Z18.000"));
  await controller.control("resume");
  assert.equal(scripts.at(-1), "RESUME_BASE VELOCITY=5");
  await controller.control("stop");
  assert.ok(scripts.some((s) => s.includes("X80.000 Y90.000")));
  assert.equal(scripts.at(-1), "CANCEL_PRINT_BASE");
  assert.ok(!scripts.join("\n").includes("M84"));
});
test("pause and stop respect firmware travel limits beyond the default bed size", async () => {
  const { controller, scripts, setState } = setup();
  setState({
    position: [225, 90, 18],
    limits: { min: [0, 0, 0], max: [230, 225, 250] },
  });
  controller.job!.program.returnPosition = [225, 90, 18];
  await controller.control("pause");
  await controller.control("stop");
  assert.ok(scripts.some((s) => s.includes("X225.000 Y90.000")));
  const blocked = setup();
  blocked.setState({
    paused: true,
    position: [225, 90, 18],
    limits: { min: [0, 0, 0], max: [224, 225, 250] },
  });
  await assert.rejects(blocked.controller.control("pause"), /X 225.000/);
  assert.ok(blocked.scripts.every((s) => !s.includes("G1")));
});

test("job control cannot touch a different job or move with lost homing", async () => {
  const a = setup();
  a.setState({ filename: "ordinary_3d.gcode" });
  await assert.rejects(a.controller.control("stop"));
  assert.equal(a.scripts.length, 0);
  const b = setup();
  b.setState({ homed: "" });
  await assert.rejects(b.controller.control("pause"));
  assert.equal(b.scripts.length, 0);
});

test("job controls retain the Z speeds saved with the running program", async () => {
  const { controller, scripts } = setup();
  controller.job!.program.zLiftSpeed = 1.5;
  controller.job!.program.zLowerSpeed = 0.5;
  await controller.control("pause");
  assert.ok(scripts.some((s) => s.includes("G1 Z18.000 F90")));
  await controller.control("resume");
  assert.equal(scripts.at(-1), "RESUME_BASE VELOCITY=0.5");
  await controller.control("stop");
  assert.ok(scripts.at(-2)!.includes("G1 Z18.000 F90"));
});
test("readiness guards cold, idle, homed printer", () => {
  const ready = { ...status, state: "complete", idle: "Ready" };
  assert.doesNotThrow(() => assertReady(ready));
  assert.throws(() => assertReady({ ...ready, nozzleTarget: 150 }));
  assert.throws(() => assertReady({ ...ready, bed: 60 }));
  assert.throws(() => assertReady({ ...ready, homed: "" }));
});
test("reconnect reconciles paused/completed jobs by filename", async () => {
  const a = setup();
  await a.controller.reconcile({ ...status, connected: false });
  assert.equal(a.controller.job?.state, "disconnected");
  await a.controller.reconcile({ ...status, state: "paused", paused: true });
  assert.equal(a.controller.job?.state, "paused");
  await a.controller.reconcile({ ...status, state: "complete", progress: 1 });
  assert.equal(a.controller.job?.state, "completed");
});
