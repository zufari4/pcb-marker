import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { readBoard } from "../src/core/gerber";
import { connectedStrokes } from "../src/core/routing";
import { fitCorners, machinePoint, distance } from "../src/core/registration";
import { createProgram, displayMotions } from "../src/core/program";
import {
  defaults,
  hasConnectionSettings,
  drawingSchema,
} from "../src/shared/settings";
import { localizeMessage, resolveLanguage } from "../src/shared/messages";
import type { Board, Corners, XY } from "../src/shared/model";

const corners: Corners = {
  fl: [104, 77.5],
  fr: [223, 76.5],
  rr: [225, 165.5],
  rl: [106, 166.5],
};
const board: Board = {
  name: "test",
  bounds: [0, -115, 107, -44],
  layers: {
    top: {
      strokes: [
        {
          kind: "track",
          points: [
            [10, -100],
            [20, -90],
          ],
        },
      ],
      trackCount: 1,
      padCount: 0,
    },
    bottom: {
      strokes: [
        {
          kind: "track",
          points: [
            [10, -100],
            [20, -90],
          ],
        },
      ],
      trackCount: 1,
      padCount: 0,
    },
  },
  files: [],
  warnings: [],
};
test("corners outside travel limits are valid references; actual paths stay constrained", () => {
  const reg = fitCorners(corners);
  assert.ok(reg.residual < 1);
  const p = createProgram(
    board,
    "top",
    corners,
    { ...defaults.drawing, contactZ: 15.8 },
    [106, 166.5, 40],
  );
  assert.ok(
    p.motions.every(
      (m) => m.to[0] >= 0 && m.to[0] <= 220 && m.to[1] >= 0 && m.to[1] <= 220,
    ),
  );
  const tooLarge = {
    ...board,
    bounds: [0, -115, 120, -44] as [number, number, number, number],
  };
  assert.throws(() =>
    createProgram(tooLarge, "top", corners, defaults.drawing, [106, 166.5, 40]),
  );
});
test("registration preserves scale and mirrors the bottom about the same blank center", () => {
  const reg = fitCorners(corners),
    p: XY = [15, -80];
  const a = machinePoint(p, board.bounds, "top", reg),
    b = machinePoint(p, board.bounds, "bottom", reg);
  const c = Math.cos(reg.angle),
    s = Math.sin(reg.angle);
  assert.ok(
    Math.abs(
      (a[0] - reg.center[0]) * c +
        (a[1] - reg.center[1]) * s +
        (b[0] - reg.center[0]) * c +
        (b[1] - reg.center[1]) * s,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(
      distance(
        machinePoint([0, -115], board.bounds, "top", reg),
        machinePoint([107, -115], board.bounds, "top", reg),
      ) - 107,
    ) < 1e-8,
  );
  assert.throws(() => fitCorners({ ...corners, fr: corners.fl }));
  assert.throws(() => fitCorners({}));
});
test("frame goes first, first move lifts, travel uses configured lift rather than initial Z", () => {
  const p = createProgram(
    board,
    "top",
    corners,
    { ...defaults.drawing, contactZ: 16, lift: 2 },
    [106, 166.5, 40],
  );
  assert.equal(p.motions[0].operation, "lift");
  assert.equal(p.motions[0].to[2], 40);
  const lifts = p.motions.filter((m) => m.operation === "lift").slice(1);
  assert.ok(lifts.every((m) => m.to[2] === 18));
  assert.deepEqual(p.motions.at(-1)!.to, [106, 166.5, 18]);
  assert.ok(!/G28|M84|START_PRINT|M109|M190/.test(p.gcode));
  const down = p.motions.filter((m) => m.operation === "lower");
  assert.equal(down.length, 2);
  assert.ok(p.motions[3].operation === "draw");
});
test("dry run never touches the board and ends raised at launch XY", () => {
  const p = createProgram(
    board,
    "bottom",
    corners,
    { ...defaults.drawing, contactZ: 16, lift: 2 },
    [106, 166.5, 40],
    true,
  );
  assert.ok(p.motions.every((m) => m.to[2] >= 18));
  assert.ok(p.motions.every((m) => m.operation !== "draw"));
});

test("Z speeds preserve legacy defaults and reject invalid values", () => {
  const { zLiftSpeed, zLowerSpeed, ...legacy } = defaults.drawing;
  assert.deepEqual(drawingSchema.parse(legacy), defaults.drawing);
  for (const key of ["zLiftSpeed", "zLowerSpeed"]) {
    for (const value of [0, -1, 5.1, NaN, Infinity])
      assert.equal(
        drawingSchema.safeParse({ ...defaults.drawing, [key]: value }).success,
        false,
      );
  }
});

test("drawing and dry-run Z commands use independent speeds and matching durations", () => {
  for (const dry of [false, true]) {
    const cfg = {
      ...defaults.drawing,
      contactZ: 16,
      lift: 2,
      zLiftSpeed: 2,
      zLowerSpeed: 0.5,
    };
    const p = createProgram(board, "top", corners, cfg, [106, 166.5, 17], dry);
    assert.equal(p.zLiftSpeed, 2);
    assert.equal(p.zLowerSpeed, 0.5);
    for (const motion of p.motions) {
      const speed =
        motion.operation === "lift"
          ? 2
          : motion.operation === "lower"
            ? 0.5
            : motion.operation === "draw" || motion.path
              ? cfg.drawSpeed
              : cfg.travelSpeed;
      const command = p.gcode.slice(motion.byteStart, motion.byteEnd).trim();
      assert.ok(command.endsWith(` F${speed * 60}`), command);
      assert.ok(
        Math.abs(
          motion.end - motion.start - distance(motion.from, motion.to) / speed,
        ) < 1e-8,
      );
    }
  }
});
test("connected track and ring form one trail without retracing edges", () => {
  const result = connectedStrokes([
    {
      kind: "pad",
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    },
    {
      kind: "track",
      points: [
        [-2, 0.5],
        [0, 0.5],
      ],
    },
  ]);
  assert.equal(result.length, 1);
  const length = result[0].points
    .slice(1)
    .reduce((sum, p, i) => sum + distance(p, result[0].points[i]), 0);
  assert.ok(Math.abs(length - 6) < 1e-7);
});
const header = "%FSLAX24Y24*%\n%MOMM*%\n%ADD10C,0.2*%\nD10*\n";
test("Gerber ZIP parses pad midline and excludes copper regions and tagged pour strokes", async () => {
  const outline =
    header +
    "X0Y0D02*\nX100000Y0D01*\nX100000Y100000D01*\nX0Y100000D01*\nX0Y0D01*\nM02*";
  const copper =
    header +
    "%ADD11C,2*%\nD11*\nX50000Y50000D03*\nD10*\nX10000Y50000D02*\nX50000Y50000D01*\nG04 Copper Start*\nX10000Y10000D02*\nX90000Y10000D01*\nG04 Copper End*\nM02*";
  const drill = "M48\nMETRIC,TZ\nT01C1.0\n%\nG90\nT01\nX5.0Y5.0\nM30\n";
  const data = zipSync({
    "board.GKO": strToU8(outline),
    "top.GTL": strToU8(copper),
    "holes.DRL": strToU8(drill),
  });
  const parsed = await readBoard(data, "fixture.zip");
  assert.deepEqual(parsed.bounds, [0, 0, 10, 10]);
  const paths = parsed.layers.top!.strokes;
  assert.equal(paths.length, 1);
  assert.ok(paths.every((s) => s.points.every((p) => p[1] > 4)));
  const circlePoints = paths[0].points.filter((p) => p[0] > 4.3);
  assert.ok(circlePoints.length > 100);
  assert.ok(
    circlePoints.every((p) => Math.abs(distance(p, [5, 5]) - 0.75) < 0.004),
  );
});
test("language defaults and translated errors", () => {
  assert.equal(resolveLanguage("system", "ru-RU"), "ru");
  assert.equal(resolveLanguage("system", "de-DE"), "en");
  assert.equal(resolveLanguage("ru", "en-US"), "ru");
  assert.equal(localizeMessage("Принтер занят.", "en"), "The printer is busy.");
});

test("dry-run display separates artwork from transfers, including saved legacy jobs", () => {
  const cfg = { ...defaults.drawing, contactZ: 15.8 };
  const dry = createProgram(board, "top", corners, cfg, [106, 166.5, 40], true);
  const ink = createProgram(
    board,
    "top",
    corners,
    cfg,
    [106, 166.5, 40],
    false,
  );
  const drawn = displayMotions(dry).filter((m) => m.operation === "draw");
  const expected = ink.motions.filter((m) => m.operation === "draw");
  assert.deepEqual(
    drawn.map((m) => [m.from.slice(0, 2), m.to.slice(0, 2)]),
    expected.map((m) => [m.from.slice(0, 2), m.to.slice(0, 2)]),
  );
  assert.equal(displayMotions(dry).at(-1)?.operation, "travel");
  const legacy = { ...dry, motions: dry.motions.map(({ path, ...m }) => m) };
  assert.deepEqual(
    displayMotions(legacy).map((m) => m.operation),
    displayMotions(dry).map((m) => m.operation),
  );
  assert.ok(dry.motions.every((m) => m.to[2] >= cfg.contactZ + cfg.lift));
});

test("automatic connection requires all saved credentials", () => {
  assert.equal(hasConnectionSettings(defaults), false);
  const configured = { ...defaults, host: "127.0.0.1", password: "saved" };
  assert.equal(hasConnectionSettings(configured), true);
  assert.equal(hasConnectionSettings({ ...configured, host: " " }), false);
  assert.equal(hasConnectionSettings({ ...configured, username: " " }), false);
  assert.equal(hasConnectionSettings({ ...configured, password: "" }), false);
});
