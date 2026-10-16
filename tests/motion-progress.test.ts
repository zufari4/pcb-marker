import { test } from "node:test";
import assert from "node:assert/strict";
import { motionAt, motionPoint } from "../src/core/program";
import type { Motion } from "../src/shared/model";
import {
  advanceMotionProgress,
  initialMotionProgress,
  interpolateMotionProgress,
} from "../src/core/motion-progress";

const frame: Motion[] = [
  {
    from: [10, 10, 2],
    to: [110, 10, 2],
    operation: "draw",
    start: 0,
    end: 10,
    byteEnd: 100,
  },
  {
    from: [110, 10, 2],
    to: [110, 90, 2],
    operation: "draw",
    start: 10,
    end: 18,
    byteEnd: 200,
  },
];

test("telemetry interpolation follows corners and stops at the confirmed endpoint", () => {
  const from = { index: 0, fraction: 0.8 };
  const to = { index: 1, fraction: 0.5 };
  const positions = [0, 0.25, 0.5, 0.75, 1, 2].map((amount) => {
    const progress = interpolateMotionProgress(frame, from, to, amount);
    return motionPoint(frame[progress.index], progress.fraction);
  });
  assert.deepEqual(positions, [
    [90, 10, 2],
    [105, 10, 2],
    [110, 20, 2],
    [110, 35, 2],
    [110, 50, 2],
    [110, 50, 2],
  ]);
});

test("interpolation handles stationary samples and zero-duration movements", () => {
  const target = { index: 0, fraction: 0.5 };
  assert.deepEqual(
    interpolateMotionProgress(frame, target, target, 0.5),
    target,
  );
  const instant = frame.map((m) => ({ ...m, start: 0, end: 0 }));
  const next = { index: 1, fraction: 1 };
  assert.deepEqual(
    interpolateMotionProgress(instant, target, next, 0.5),
    target,
  );
  assert.deepEqual(interpolateMotionProgress(instant, target, next, 1), next);
  assert.deepEqual(
    interpolateMotionProgress(
      [],
      initialMotionProgress,
      initialMotionProgress,
      0.5,
    ),
    initialMotionProgress,
  );
});

test("an executing long move is tracked while file_position stays at its start", () => {
  const route = frame.map((motion, index) => ({
    ...motion,
    byteStart: index ? 100 : 80,
  }));
  assert.deepEqual(
    advanceMotionProgress(route, initialMotionProgress, [60, 10, 2], 79),
    initialMotionProgress,
  );
  let progress = advanceMotionProgress(
    route,
    initialMotionProgress,
    [60, 10, 2],
    80,
  );
  assert.deepEqual(progress, { index: 0, fraction: 0.5 });
  for (const fraction of [0.25, 0.5, 0.75]) {
    progress = advanceMotionProgress(
      route,
      progress,
      [110, 10 + 80 * fraction, 2.15],
      100,
    );
    assert.deepEqual(progress, { index: 1, fraction });
  }
});

test("legacy jobs include the in-flight command but never search beyond it", () => {
  assert.deepEqual(
    advanceMotionProgress(frame, { index: 0, fraction: 1 }, [110, 50, 2], 100),
    { index: 1, fraction: 0.5 },
  );
  const route = [
    ...frame,
    {
      ...frame[1],
      from: [110, 90, 2] as [number, number, number],
      to: [10, 90, 2] as [number, number, number],
      byteEnd: 300,
    },
  ];
  const previous = { index: 0, fraction: 1 };
  assert.deepEqual(
    advanceMotionProgress(route, previous, [60, 90, 2], 100),
    previous,
  );
  assert.deepEqual(
    advanceMotionProgress([], initialMotionProgress, [0, 0, 0], 0),
    initialMotionProgress,
  );
});

test("read-ahead never paints beyond the live marker on frame edges", () => {
  const halfway = advanceMotionProgress(
    frame,
    initialMotionProgress,
    [60, 10, 2],
    999,
  );
  assert.deepEqual(halfway, { index: 0, fraction: 0.5 });
  assert.deepEqual(
    advanceMotionProgress(frame, halfway, [60, 10, 2], 9999),
    halfway,
  );
  const corner = advanceMotionProgress(frame, halfway, [110, 10, 2], 999);
  assert.deepEqual(corner, { index: 0, fraction: 1 });
  const nextEdge = advanceMotionProgress(frame, corner, [110, 50, 2], 999);
  assert.deepEqual(nextEdge, { index: 1, fraction: 0.5 });
  assert.deepEqual(
    motionPoint(frame[nextEdge.index], nextEdge.fraction),
    [110, 50, 2],
  );
});

test("live progress stays monotonic and ignores positions outside the route", () => {
  const previous = { index: 0, fraction: 0.5 };
  assert.deepEqual(
    advanceMotionProgress(frame, previous, [40, 10, 2], 999),
    previous,
  );
  assert.deepEqual(
    advanceMotionProgress(frame, previous, [70, 10, 1.728], 999),
    { index: 0, fraction: 0.6 },
  );
  assert.deepEqual(
    advanceMotionProgress(frame, previous, [60, 50, 2], 999),
    previous,
  );
  assert.deepEqual(
    advanceMotionProgress(frame, previous, [NaN, 10, 2], 999),
    previous,
  );
  assert.deepEqual(
    advanceMotionProgress(frame, initialMotionProgress, [60, 10, 2], 99),
    initialMotionProgress,
  );
});

test("crossings prefer the first uncompleted route visit and pure vertical moves retain Z progress", () => {
  const route: Motion[] = [
    {
      ...frame[0],
      from: [0, 0, 4],
      to: [10, 0, 4],
      operation: "travel",
      byteEnd: 100,
    },
    {
      ...frame[0],
      from: [10, 0, 4],
      to: [10, 0, 2],
      operation: "lower",
      byteEnd: 200,
    },
    { ...frame[0], from: [10, 0, 2], to: [0, 0, 2], byteEnd: 300 },
    { ...frame[0], from: [0, 0, 2], to: [10, 0, 2], byteEnd: 400 },
  ];
  assert.deepEqual(
    advanceMotionProgress(route, initialMotionProgress, [5, 0, 4], 400),
    { index: 0, fraction: 0.5 },
  );
  assert.deepEqual(
    advanceMotionProgress(route, { index: 2, fraction: 0 }, [5, 0, 2], 400),
    { index: 2, fraction: 0.5 },
  );
  assert.deepEqual(
    advanceMotionProgress(route, { index: 3, fraction: 0.2 }, [5, 0, 2], 400),
    { index: 3, fraction: 0.5 },
  );
  assert.deepEqual(
    advanceMotionProgress(route, { index: 1, fraction: 0 }, [10, 0, 3], 400),
    { index: 1, fraction: 0.5 },
  );
});

test("reported tilted frame coordinates keep advancing despite bed compensation", () => {
  const edges: Motion[] = [
    {
      ...frame[0],
      from: [110.45842963024424, 86.83000328856758, 16.8],
      to: [217.4456830177622, 85.17845474401395, 16.8],
    },
    {
      ...frame[1],
      from: [217.4456830177622, 85.17845474401395, 16.8],
      to: [218.54157036975576, 156.16999671143242, 16.8],
    },
  ];
  const next = advanceMotionProgress(
    edges,
    { index: 0, fraction: 0.55 },
    [218.113, 128.368, 16.528],
    999,
  );
  assert.equal(next.index, 1);
  assert.ok(next.fraction > 0.6 && next.fraction < 0.62);
});

test("preview progress interpolates on its own frame edge and clamps endpoints", () => {
  const progress = motionAt(frame, 14);
  assert.equal(progress.index, 1);
  assert.equal(progress.fraction, 0.5);
  assert.deepEqual(progress.position, [110, 50, 2]);
  assert.deepEqual(
    motionPoint(frame[progress.index], progress.fraction),
    progress.position,
  );
  assert.deepEqual(motionPoint(frame[0], -1), frame[0].from);
  assert.deepEqual(motionPoint(frame[0], 2), frame[0].to);
});

test("file progress highlights only fully read motion commands", () => {
  for (const [bytes, index] of [
    [0, -1],
    [99, -1],
    [100, 0],
    [150, 0],
    [199, 0],
    [200, 1],
    [999, 1],
  ]) {
    const progress = motionAt(frame, bytes, "bytes");
    assert.equal(progress.index, index, `file position ${bytes}`);
    assert.deepEqual(
      progress.position,
      index < 0 ? frame[0].from : frame[index].to,
    );
    assert.equal(progress.fraction, index < 0 ? 0 : 1);
  }
  assert.equal(motionAt([], 0, "bytes").index, -1);
});
