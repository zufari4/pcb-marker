import type { MotionLimits, XYZ } from "../shared/model";

// Used only for offline previews and legacy snapshots without printer telemetry.
export const defaultMotionLimits: MotionLimits = {
  min: [0, 0, 0],
  max: [220, 220, 250],
};

export function gcodeMotionLimits(
  axisMinimum: unknown,
  axisMaximum: unknown,
  machinePosition: unknown,
  gcodePosition: unknown,
): MotionLimits {
  const vectors = [axisMinimum, axisMaximum, machinePosition, gcodePosition];
  if (
    !vectors.every(
      (v) =>
        Array.isArray(v) &&
        v.length >= 3 &&
        v.slice(0, 3).every(Number.isFinite),
    )
  )
    throw new Error("Не удалось считать пределы перемещения принтера.");
  const [min, max, machine, gcode] = (vectors as number[][]).map((v) =>
    v.slice(0, 3),
  ) as XYZ[];
  if (min.some((v, i) => v >= max[i]))
    throw new Error("Не удалось считать пределы перемещения принтера.");
  // G92 / SET_GCODE_OFFSET affect G-code coordinates, not toolhead axis limits.
  return {
    min: min.map((v, i) => v + (gcode[i] - machine[i])) as XYZ,
    max: max.map((v, i) => v + (gcode[i] - machine[i])) as XYZ,
  };
}
