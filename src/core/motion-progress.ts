import type { Motion, XYZ } from "../shared/model";
import { motionAt } from "./program";

export interface MotionProgress {
  index: number;
  fraction: number;
}

export const initialMotionProgress: MotionProgress = { index: -1, fraction: 0 };

/** Interpolate along the ordered route, never across corners or past telemetry. */
export function interpolateMotionProgress(
  motions: Motion[],
  from: MotionProgress,
  to: MotionProgress,
  amount: number,
): MotionProgress {
  if (amount >= 1) return to;
  if (amount <= 0 || from.index < 0 || to.index < from.index) return from;
  if (from.index === to.index)
    return {
      index: from.index,
      fraction:
        from.fraction + Math.max(0, to.fraction - from.fraction) * amount,
    };
  const first = motions[from.index],
    last = motions[to.index];
  if (!first || !last) return from;
  const start = first.start + (first.end - first.start) * from.fraction;
  const end = last.start + (last.end - last.start) * to.fraction;
  if (end <= start) return from;
  const result = motionAt(motions, start + (end - start) * amount);
  return { index: result.index, fraction: result.fraction };
}

/** Match live coordinates to the ordered route. Read-ahead only bounds the search;
 * it is never evidence that a movement has physically completed. */
export function advanceMotionProgress(
  motions: Motion[],
  previous: MotionProgress,
  position: XYZ,
  filePosition: number,
): MotionProgress {
  if (!position.every(Number.isFinite)) return previous;
  const lastCompletedCommand = motionAt(motions, filePosition, "bytes").index;
  const inFlight = lastCompletedCommand + 1;
  // Klipper advances file_position after run_script returns. A long G1 can
  // already be moving while file_position still points to its first byte.
  // Legacy programs emitted consecutive motion commands, so the previous
  // byteEnd is also the next command's start.
  const commandStart =
    motions[inFlight]?.byteStart ??
    (inFlight > 0 ? motions[inFlight - 1].byteEnd : motions[0]?.byteEnd) ??
    Infinity;
  const searchThrough =
    inFlight < motions.length && filePosition >= commandStart
      ? inFlight
      : lastCompletedCommand;
  for (
    let index = Math.max(0, previous.index);
    index <= searchThrough;
    index++
  ) {
    const motion = motions[index];
    // Horizontal progress is planar: live Z includes bed compensation, while
    // the program contains logical Z. Comparing them freezes valid XY motion.
    // Pure lifts/lowers still use Z to report their own progress.
    const axes =
      motion.to[0] !== motion.from[0] || motion.to[1] !== motion.from[1]
        ? 2
        : 3;
    const delta = motion.to
      .slice(0, axes)
      .map((v, axis) => v - motion.from[axis]);
    const lengthSquared = delta.reduce((sum, v) => sum + v * v, 0);
    const projection = lengthSquared
      ? delta.reduce(
          (sum, v, axis) => sum + v * (position[axis] - motion.from[axis]),
          0,
        ) / lengthSquared
      : 1;
    const minimum = index === previous.index ? previous.fraction : 0;
    const fraction = Math.max(minimum, Math.min(1, projection));
    const error = Math.hypot(
      ...delta.map(
        (v, axis) => position[axis] - motion.from[axis] - v * fraction,
      ),
    );
    // G-code is rounded to 0.001 mm. Allow small reporting errors, but prefer
    // the earliest matching segment at intersections and repeated positions.
    if (error <= 0.05) return { index, fraction };
  }
  return previous;
}
