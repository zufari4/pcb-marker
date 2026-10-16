import type { Bounds, Corners, Registration, Side, XY } from "../shared/model";
export const cornerKeys = ["fl", "fr", "rr", "rl"] as const;
export const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((v, i) => v - b[i]));
export function pointBounds(points: Iterable<XY>): Bounds {
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x);
    bounds[3] = Math.max(bounds[3], y);
  }
  return bounds.every(Number.isFinite) ? bounds : [0, 0, 1, 1];
}
export function fitCorners(corners: Corners): Registration {
  const points = cornerKeys.map((k) => corners[k]);
  if (points.some((p) => !p || p.length !== 2 || !p.every(Number.isFinite)))
    throw new Error("Считайте все четыре угла заготовки.");
  const [fl, fr, rr, rl] = points as XY[];
  const edges = (points as XY[]).map((p, i) => [
    (points[(i + 1) % 4] as XY)[0] - p[0],
    (points[(i + 1) % 4] as XY)[1] - p[1],
  ]);
  if (
    edges.some(
      (e, i) =>
        Math.hypot(...e) < 1 ||
        e[0] * edges[(i + 1) % 4][1] - e[1] * edges[(i + 1) % 4][0] <= 0,
    )
  )
    throw new Error("Углы перепутаны или совпадают.");
  const vx = [
    (fr[0] + rr[0] - fl[0] - rl[0]) / 2,
    (fr[1] + rr[1] - fl[1] - rl[1]) / 2,
  ];
  const vy = [
    (rl[0] + rr[0] - fl[0] - fr[0]) / 2,
    (rl[1] + rr[1] - fl[1] - fr[1]) / 2,
  ];
  const nx = Math.hypot(...vx),
    ny = Math.hypot(...vy);
  const angle = Math.atan2(vx[1] / nx - vy[0] / ny, vx[0] / nx + vy[1] / ny);
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const width = vx[0] * c + vx[1] * s,
    height = -vy[0] * s + vy[1] * c;
  const center: XY = [0, 1].map(
    (i) => (points as XY[]).reduce((sum, p) => sum + p[i], 0) / 4,
  ) as XY;
  const signs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const residual = Math.max(
    ...(points as XY[]).map((p, i) => {
      const x = (signs[i][0] * width) / 2,
        y = (signs[i][1] * height) / 2;
      return distance(p, [
        center[0] + c * x - s * y,
        center[1] + s * x + c * y,
      ]);
    }),
  );
  if (residual > 1)
    throw new Error(
      `Углы не образуют прямоугольник: отклонение ${residual.toFixed(2)} мм.`,
    );
  return { center, angle, width, height, residual };
}
export function localPoint(p: XY, bounds: Bounds, side: Side): XY {
  return [
    side === "top" ? p[0] - bounds[0] : bounds[2] - p[0],
    p[1] - bounds[1],
  ];
}
export function machinePoint(
  p: XY,
  bounds: Bounds,
  side: Side,
  reg: Registration,
): XY {
  const local = localPoint(p, bounds, side);
  const x = local[0] - (bounds[2] - bounds[0]) / 2,
    y = local[1] - (bounds[3] - bounds[1]) / 2;
  return [
    reg.center[0] + Math.cos(reg.angle) * x - Math.sin(reg.angle) * y,
    reg.center[1] + Math.sin(reg.angle) * x + Math.cos(reg.angle) * y,
  ];
}
