import { test } from "node:test";
import assert from "node:assert/strict";
import { gcodeMotionLimits } from "../src/core/limits";
import { assertPosition, createProgram } from "../src/core/program";
import { defaults } from "../src/shared/settings";
import { KlipperConnection } from "../src/main/klipper";
import { JobController, type PrinterTransport } from "../src/main/jobs";
import type { Board, Corners, PrinterStatus } from "../src/shared/model";

test("Klipper travel limits are converted to G-code coordinates and ignore extra axes", () => {
  const limits = gcodeMotionLimits(
    [-5, -10, 0, 0],
    [230, 225, 250, 0],
    [100, 100, 20, 0],
    [102, 97, 18, 0],
  );
  assert.deepEqual(limits, { min: [-3, -13, -2], max: [232, 222, 248] });
  assert.doesNotThrow(() => assertPosition([221.994, 78.99, 18.837], limits));
  assert.doesNotThrow(() => assertPosition([-3, -13, -2], limits));
  assert.throws(
    () => assertPosition([232.001, 80, 20], limits),
    /X 232.001.*232.000/,
  );
  assert.throws(() => assertPosition([0, 223, 20], limits), /Y 223.000/);
  assert.throws(() => assertPosition([0, 80, 249], limits), /Z 249.000/);
  for (const invalid of [undefined, [0, 0], [0, NaN, 0], [0, Infinity, 0]])
    assert.throws(() =>
      gcodeMotionLimits(invalid, [230, 225, 250], [0, 0, 0], [0, 0, 0]),
    );
  assert.throws(() =>
    gcodeMotionLimits([0, 0, 0], [0, 225, 250], [0, 0, 0], [0, 0, 0]),
  );
});

const board: Board = {
  name: "limit test",
  bounds: [0, 0, 4, 4],
  files: [],
  warnings: [],
  layers: {
    top: {
      trackCount: 1,
      padCount: 0,
      strokes: [
        {
          kind: "track",
          points: [
            [0, 0],
            [4, 4],
          ],
        },
      ],
    },
  },
};
const corners: Corners = {
  fl: [221, 80],
  fr: [225, 80],
  rr: [225, 84],
  rl: [221, 84],
};

test("drawing and dry run use printer limits for the whole route, including the origin", () => {
  const limits = { min: [0, 0, 0], max: [230, 225, 250] } as const;
  const range = { min: [...limits.min], max: [...limits.max] } as Parameters<
    typeof assertPosition
  >[1];
  for (const dry of [false, true]) {
    const program = createProgram(
      board,
      "top",
      corners,
      defaults.drawing,
      [221.994, 78.99, 18.837],
      dry,
      range,
    );
    assert.ok(program.motions.some((m) => m.to[0] === 225));
    assert.throws(
      () =>
        createProgram(
          board,
          "top",
          corners,
          defaults.drawing,
          [219, 80, 20],
          dry,
        ),
      /Допустимый диапазон/,
    );
    assert.throws(
      () =>
        createProgram(
          board,
          "top",
          corners,
          defaults.drawing,
          [231, 80, 20],
          dry,
          range,
        ),
      /X 231/,
    );
  }
});

test("status reads firmware limits and jobs recheck them before launch", async () => {
  const api = new KlipperConnection();
  api.query = async (objects) => {
    assert.ok(objects.toolhead.includes("axis_maximum"));
    return {
      toolhead: {
        homed_axes: "xyz",
        axis_minimum: [0, 0, 0, 0],
        axis_maximum: [230, 225, 250, 0],
      },
      gcode_move: {
        position: [221.994, 78.99, 18.837],
        gcode_position: [221.994, 78.99, 18.837],
      },
      print_stats: { state: "standby", filename: "", message: "" },
      idle_timeout: { state: "Ready" },
      virtual_sdcard: {},
      extruder: { temperature: 25, target: 0 },
      heater_bed: { temperature: 25, target: 0 },
    };
  };
  const status = await api.status();
  assert.deepEqual(status.limits?.max, [230, 225, 250]);
  for (const shrink of [false, true]) {
    let reads = 0;
    const scripts: string[] = [];
    const transport: PrinterTransport = {
      status: async () => status,
      prepare: async (): Promise<PrinterStatus> => ({
        ...status,
        limits:
          shrink && ++reads === 2
            ? { min: [0, 0, 0], max: [220, 225, 250] }
            : status.limits,
      }),
      upload: async () => {},
      script: async (code) => {
        scripts.push(code);
      },
    };
    const controller = new JobController(
      transport,
      null,
      async () => {},
      () => {},
    );
    const start = controller.start(
      board,
      "top",
      corners,
      defaults.drawing,
      true,
    );
    if (shrink) {
      await assert.rejects(start, /Допустимый диапазон/);
      assert.equal(scripts.length, 0);
    } else {
      assert.equal((await start).state, "running");
      assert.match(scripts[0], /SDCARD_PRINT_FILE/);
    }
  }
});
