import type {
  Board,
  Corners,
  DrawingSettings,
  Motion,
  Operation,
  Program,
  Side,
  Stroke,
  XYZ,
} from "../shared/model";
import { drawingSchema } from "../shared/settings";
import { distance, fitCorners, machinePoint } from "./registration";

export function boardStrokes(
  board: Board,
  side: Side,
  frame: boolean,
): Stroke[] {
  const layer = board.layers[side];
  if (!layer) throw new Error("В архиве нет выбранной стороны платы.");
  const [x0, y0, x1, y1] = board.bounds;
  return [
    ...(frame
      ? [
          {
            kind: "frame" as const,
            points: [
              [x0, y0],
              [x1, y0],
              [x1, y1],
              [x0, y1],
              [x0, y0],
            ] as [number, number][],
          },
        ]
      : []),
    ...layer.strokes,
  ];
}
export function assertPosition(p: XYZ): void {
  if (
    !p.every(
      (v, i) => Number.isFinite(v) && v >= 0 && v <= (i === 2 ? 250 : 220),
    )
  )
    throw new Error(
      `Сопло выходит за допустимую область: X ${p[0].toFixed(3)}, Y ${p[1].toFixed(3)}, Z ${p[2].toFixed(3)} мм.`,
    );
}
export function createProgram(
  board: Board,
  side: Side,
  corners: Corners,
  settings: DrawingSettings,
  origin: XYZ,
  dry = false,
): Program {
  const cfg = drawingSchema.parse(settings),
    reg = fitCorners(corners);
  if (
    board.bounds[2] - board.bounds[0] > reg.width + 0.01 ||
    board.bounds[3] - board.bounds[1] > reg.height + 0.01
  )
    throw new Error(
      "Рисунок больше заготовки, измеренной по углам. Масштаб остаётся 1:1.",
    );
  assertPosition(origin);
  const strokes = boardStrokes(board, side, cfg.frame);
  if (!strokes.length) throw new Error("На выбранной стороне нет траекторий.");
  return compileProgram(
    strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((p) =>
        machinePoint(p, board.bounds, side, reg),
      ),
    })),
    cfg,
    origin,
    side,
    dry,
    true,
  );
}
/** The preview and printer share this exact motion compiler. */
export function compileProgram(
  strokes: Stroke[],
  cfg: DrawingSettings,
  origin: XYZ,
  side: Side,
  dry: boolean,
  validate = false,
): Program {
  const travelZ = cfg.contactZ + cfg.lift;
  const lines = [
    "; PCB MARKER 2",
    "; PCB_FIXED_REGISTRATION",
    `; PCB_TRAVEL_Z ${travelZ.toFixed(3)}`,
    "G90",
    "M104 S0",
    "M140 S0",
    "M107",
  ];
  const motions: Motion[] = [];
  let position: XYZ = [...origin],
    time = 0,
    bytes = lines.join("\n").length + 1;
  const move = (
    to: XYZ,
    speed: number,
    operation: Operation,
    zOnly = false,
    dwell = false,
    path = false,
  ) => {
    if (validate) assertPosition(to);
    const line = dwell
      ? "G4 P100"
      : `G1 ${zOnly ? `Z${to[2].toFixed(3)}` : `X${to[0].toFixed(3)} Y${to[1].toFixed(3)}`} F${Math.round(speed * 60)}`;
    const byteStart = bytes;
    lines.push(line);
    bytes += line.length + 1;
    const duration = dwell ? 0.1 : distance(position, to) / speed;
    motions.push({
      from: position,
      to,
      operation,
      start: time,
      end: time + duration,
      byteStart,
      byteEnd: bytes,
      path,
    });
    position = to;
    time += duration;
  };
  move(
    [origin[0], origin[1], Math.max(origin[2], travelZ)],
    cfg.zLiftSpeed,
    "lift",
    true,
  );
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    const first = stroke.points[0];
    move([first[0], first[1], position[2]], cfg.travelSpeed, "travel");
    move(
      [first[0], first[1], dry ? travelZ : cfg.contactZ],
      cfg.zLowerSpeed,
      "lower",
      true,
    );
    if (stroke.points.length === 1)
      move(
        [...position],
        cfg.drawSpeed,
        dry ? "travel" : "draw",
        false,
        true,
        true,
      );
    for (const p of stroke.points.slice(1))
      move(
        [p[0], p[1], position[2]],
        cfg.drawSpeed,
        dry ? "travel" : "draw",
        false,
        false,
        true,
      );
    if (!dry)
      move([position[0], position[1], travelZ], cfg.zLiftSpeed, "lift", true);
  }
  move([position[0], position[1], travelZ], cfg.zLiftSpeed, "lift", true);
  move([origin[0], origin[1], travelZ], cfg.travelSpeed, "travel");
  lines.push("M400", "; Finished; motors remain enabled.");
  return {
    gcode: lines.join("\n") + "\n",
    motions,
    duration: time,
    returnPosition: origin,
    travelZ,
    zLiftSpeed: cfg.zLiftSpeed,
    zLowerSpeed: cfg.zLowerSpeed,
    side,
    dry,
  };
}
/** Display dry-run artwork as paths, keeping non-drawing transfers distinct. */
export function displayMotions(program: Program): Motion[] {
  if (!program.dry) return program.motions;
  let enteredPath = false;
  return program.motions.map((motion, index, motions) => {
    if (motion.operation === "lower") enteredPath = true;
    // Older saved jobs have no path flag. Their transfers precede a lowering
    // command, and the final movement returns to the launch position.
    const path =
      motion.path ??
      (enteredPath &&
        index < motions.length - 1 &&
        motions[index + 1]?.operation !== "lower");
    return motion.operation === "travel" && path
      ? { ...motion, operation: "draw" }
      : motion;
  });
}
export function motionPoint(motion: Motion, fraction: number): XYZ {
  const t = Math.max(0, Math.min(1, fraction));
  return motion.from.map((v, i) => v + (motion.to[i] - v) * t) as XYZ;
}

export function motionAt(
  motions: Motion[],
  value: number,
  mode: "time" | "bytes" = "time",
): { index: number; fraction: number; position: XYZ; operation: Operation } {
  if (!motions.length)
    return { index: -1, fraction: 0, position: [0, 0, 0], operation: "idle" };
  if (mode === "bytes") {
    // File position counts consumed commands, not the physical tool position.
    // Never include a command whose end has not yet been read.
    let lo = 0,
      hi = motions.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (motions[mid].byteEnd <= value) lo = mid + 1;
      else hi = mid;
    }
    const index = lo - 1;
    return index < 0
      ? { index, fraction: 0, position: motions[0].from, operation: "idle" }
      : {
          index,
          fraction: 1,
          position: motions[index].to,
          operation: motions[index].operation,
        };
  }
  let lo = 0,
    hi = motions.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (motions[mid].end < value) lo = mid + 1;
    else hi = mid;
  }
  const m = motions[lo],
    t = Math.max(0, Math.min(1, (value - m.start) / (m.end - m.start || 1)));
  return {
    index: lo,
    fraction: t,
    position: motionPoint(m, t),
    operation: m.operation,
  };
}
