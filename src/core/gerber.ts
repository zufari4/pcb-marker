import parserFactory from "gerber-parser";
import plotterFactory from "gerber-plotter";
import { unzipSync, strFromU8 } from "fflate";
import type { Board, BoardLayer, Stroke, XY } from "../shared/model";
import {
  coords,
  empty,
  line,
  minimumRectangle,
  outlineBounds,
  parts,
  point,
  polygon,
  union,
  type Geometry,
} from "./geometry";
import { connectedStrokes } from "./routing";
import { distance } from "./registration";

type Primitive =
  | plotterFactory.Shape
  | plotterFactory.Clip
  | { type: "layer"; polarity: "dark" | "clear" };
type Chunk =
  | Exclude<plotterFactory.Chunk, plotterFactory.ChunkShape>
  | { type: "shape"; tool: string; shape: Primitive[] };
interface Plot {
  chunks: Chunk[];
  scale: number;
  warnings: string[];
}

export function stripPours(source: string): string {
  // Preserve state-setting commands and final positions of excluded strokes.
  return source.replace(
    /G04\s+(Copper|PlaneZone|SolidRegion) Start\*([\s\S]*?)G04\s+\1 End\*/g,
    (block) =>
      block.replace(/([^*%]*)(\*)/g, (whole: string, command: string) => {
        if (!/^\s*G04/.test(command) && /[XY][-+]?\d/.test(command))
          return command.replace(/D0?[123]\s*$/, "") + "D02*";
        return whole;
      }),
  );
}
export async function plotSource(
  source: string,
  drill = false,
  excludePours = false,
): Promise<Plot> {
  const parser = parserFactory({ filetype: drill ? "drill" : "gerber" });
  const plotter = plotterFactory({ optimizePaths: false });
  const chunks: Chunk[] = [],
    warnings: string[] = [];
  const warn = (w: { message: string; line?: number }) => {
    if (
      /unknown|unrecognized|not supported|assuming.*format|missing.*format/i.test(
        w.message,
      )
    )
      throw new Error(`Gerber: ${w.message} (строка ${w.line ?? "?"})`);
    warnings.push(w.message);
  };
  return new Promise((resolve, reject) => {
    parser.on("error", reject);
    plotter.on("error", reject);
    parser.on("warning", (w) => {
      try {
        warn(w);
      } catch (e) {
        reject(e);
      }
    });
    plotter.on("warning", (w) => {
      try {
        warn(w);
      } catch (e) {
        reject(e);
      }
    });
    plotter.on("data", (chunk: Chunk) => chunks.push(chunk));
    plotter.on("end", () =>
      resolve({
        chunks,
        scale: plotter.format.units === "in" ? 25.4 : 1,
        warnings,
      }),
    );
    parser.pipe(plotter);
    parser.end(excludePours ? stripPours(source) : source);
  });
}
function segmentPoints(
  segment: plotterFactory.Segment,
  scale: number,
  offset: XY,
): XY[] {
  const convert = (p: readonly number[]): XY => [
    (p[0] + offset[0]) * scale,
    (p[1] + offset[1]) * scale,
  ];
  if (segment.type === "line")
    return [convert(segment.start), convert(segment.end)];
  const steps = Math.max(
    2,
    Math.ceil(
      segment.sweep /
        (2 * Math.acos(Math.max(-1, 1 - 0.003 / (segment.radius * scale)))),
    ),
  );
  const points: XY[] = Array.from(
    { length: Math.min(steps, 10000) + 1 },
    (_, i) => {
      const angle =
        segment.start[2] +
        ((segment.dir === "cw" ? -1 : 1) * segment.sweep * i) /
          Math.min(steps, 10000);
      return convert([
        segment.center[0] + segment.radius * Math.cos(angle),
        segment.center[1] + segment.radius * Math.sin(angle),
      ]);
    },
  );
  points[0] = convert(segment.start);
  points[points.length - 1] = convert(segment.end);
  return points;
}
function shapeGeometry(
  shapes: Primitive[],
  scale: number,
  offset: XY,
): Geometry {
  let material = empty(),
    dark = true;
  for (const shape of shapes) {
    if (shape.type === "layer") {
      dark = shape.polarity === "dark";
      continue;
    }
    let g: Geometry;
    if (shape.type === "clip")
      g = shapeGeometry(shape.shape, scale, offset).intersection(
        shapeGeometry([shape.clip], scale, offset),
      );
    else if (shape.type === "poly")
      g = polygon(
        shape.points.map((p) => [
          (p[0] + offset[0]) * scale,
          (p[1] + offset[1]) * scale,
        ]),
      );
    else {
      const c: XY = [
        (shape.cx + offset[0]) * scale,
        (shape.cy + offset[1]) * scale,
      ];
      if (shape.type === "circle") g = point(c).buffer(shape.r * scale, 48);
      else if (shape.type === "ring")
        g = point(c)
          .buffer((shape.r + shape.width / 2) * scale, 48)
          .difference(
            point(c).buffer(Math.max(0, shape.r - shape.width / 2) * scale, 48),
          );
      else {
        const r = shape.r * scale,
          w = (shape.width * scale) / 2 - r,
          h = (shape.height * scale) / 2 - r;
        if (w < 1e-10 && h < 1e-10) g = point(c).buffer(r, 48);
        else if (w < 1e-10 || h < 1e-10)
          g = line([
            [c[0] - w, c[1] - h],
            [c[0] + w, c[1] + h],
          ]).buffer(r, 48);
        else {
          g = polygon([
            [c[0] - w, c[1] - h],
            [c[0] + w, c[1] - h],
            [c[0] + w, c[1] + h],
            [c[0] - w, c[1] + h],
          ]);
          if (r) g = g.buffer(r, 48);
        }
      }
    }
    material = dark ? material.union(g) : material.difference(g);
  }
  return material;
}
function collect(plot: Plot): {
  material: Geometry;
  tracks: Geometry[];
  pads: Geometry[];
} {
  const tools = new Map<string, Primitive[]>(),
    tracks: Geometry[] = [],
    pads: Geometry[] = [];
  let material = empty(),
    batch: Geometry[] = [],
    dark = true,
    offsets: XY[] = [[0, 0]];
  const flush = () => {
    if (batch.length) {
      const group = union(batch);
      material = dark ? material.union(group) : material.difference(group);
      batch = [];
    }
  };
  for (const chunk of plot.chunks) {
    if (chunk.type === "shape") {
      tools.set(chunk.tool, chunk.shape);
      continue;
    }
    if (chunk.type === "polarity") {
      flush();
      dark = chunk.polarity === "dark";
      continue;
    }
    if (chunk.type === "repeat") {
      offsets = chunk.offsets.length ? chunk.offsets : [[0, 0]];
      continue;
    }
    for (const offset of offsets) {
      if (chunk.type === "pad") {
        const shape = tools.get(chunk.tool);
        if (!shape) throw new Error(`Неизвестная апертура ${chunk.tool}`);
        const g = shapeGeometry(shape, plot.scale, [
          chunk.x + offset[0],
          chunk.y + offset[1],
        ]);
        batch.push(g);
        if (dark) pads.push(...parts(g, "Polygon"));
      } else if (chunk.type === "stroke") {
        for (const segment of chunk.path) {
          const ps = segmentPoints(segment, plot.scale, offset);
          const g =
            distance(ps[0], ps.at(-1)!) < 1e-12 && ps.length === 2
              ? point(ps[0])
              : line(ps);
          batch.push(g.buffer((chunk.width * plot.scale) / 2, 48));
          if (dark) tracks.push(g);
        }
      }
      // Region copper is deliberately excluded; no flood fill or its boundary.
    }
  }
  flush();
  return { material, tracks, pads };
}
function padCenterlines(pad: Geometry, holes: Geometry): Geometry[] {
  const outer = polygon(coords(pad.getExteriorRing()));
  const apertureHoles = Array.from(
    { length: pad.getNumInteriorRing() },
    (_, i) => polygon(coords(pad.getInteriorRingN(i))),
  );
  const nearby = parts(
    apertureHoles.length ? union([holes, ...apertureHoles]) : holes,
    "Polygon",
  ).filter((h) => outer.covers(h.getInteriorPoint()));
  if (nearby.length)
    return nearby.flatMap((h) =>
      parts(
        h.buffer(h.getBoundary().distance(outer.getBoundary()) / 2, 48),
        "Polygon",
      ).map((p) => line(coords(p.getExteriorRing()))),
    );
  const cs = coords(minimumRectangle(pad)).slice(0, 4),
    [a, b, c, d] = cs;
  const ab = distance(a, b),
    bc = distance(b, c);
  if (Math.abs(ab - bc) < 1e-6) return [pad.getCentroid()];
  const mid = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [start, end] =
    ab > bc ? [mid(a, d), mid(b, c)] : [mid(a, b), mid(d, c)];
  const t = Math.min(ab, bc) / (2 * distance(start, end));
  return [
    line([
      [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t],
      [end[0] + (start[0] - end[0]) * t, end[1] + (start[1] - end[1]) * t],
    ]),
  ];
}
export function layerPaths(plot: Plot, holes: Geometry): BoardLayer {
  const { material, tracks, pads } = collect(plot);
  const copper = material.difference(holes),
    padLines = pads.flatMap((p) => padCenterlines(p, holes));
  const rings = padLines.filter(
    (p) =>
      p.getGeometryType() === "LineString" &&
      distance(coords(p)[0], coords(p).at(-1)!) < 1e-7,
  );
  const interior = union(rings.map((r) => polygon(coords(r))));
  const trackMaterial = copper.difference(interior);
  const strokes: Stroke[] = [];
  const add = (g: Geometry, kind: Stroke["kind"]) => {
    for (const p of [...parts(g, "LineString"), ...parts(g, "Point")])
      strokes.push({ points: coords(p), kind });
  };
  for (const track of tracks) add(track.intersection(trackMaterial), "track");
  for (const pad of padLines) add(pad.intersection(copper), "pad");
  for (const h of parts(holes, "Polygon"))
    if (
      !pads.some((p) =>
        polygon(coords(p.getExteriorRing())).covers(h.getInteriorPoint()),
      )
    )
      add(line(coords(h.getExteriorRing())), "pad");
  return {
    strokes: connectedStrokes(strokes),
    padStrokes: strokes.filter((s) => s.kind === "pad"),
    trackCount: tracks.length,
    padCount: pads.length,
  };
}
export async function readBoard(
  bytes: Uint8Array,
  name: string,
  progress: (stage: string) => void = () => {},
): Promise<Board> {
  progress("Чтение Gerber…");
  let expanded = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      if (
        f.originalSize > 64 * 1024 * 1024 ||
        (expanded += f.originalSize) > 128 * 1024 * 1024
      )
        throw new Error("Архив слишком большой.");
      return /\.(gtl|gbl|gko|gml|gm1|drl|xln|gbr|ger)$/i.test(f.name);
    },
  });
  const names = Object.keys(files),
    source = (n: string) => strFromU8(files[n]).replace(/^\uFEFF/, "");
  const find = (pattern: RegExp) => {
    const found = names.filter((n) => pattern.test(n));
    if (found.length > 1)
      throw new Error(`Неоднозначный слой: ${found.join(", ")}`);
    return found[0];
  };
  const outline = find(
    /\.(gko|gml|gm1)$|(?:edge_cuts|outline|boardoutline).*\.(gbr|ger)$/i,
  );
  if (!outline) throw new Error("В ZIP нет контура платы (.GKO / Edge_Cuts).");
  const outlinePlot = await plotSource(source(outline));
  const bounds = outlineBounds(collect(outlinePlot).tracks);
  const drills = await Promise.all(
    names
      .filter((n) => /\.(drl|xln)$/i.test(n))
      .map((n) => plotSource(source(n), true)),
  );
  const holes = union(drills.map((d) => collect(d).material));
  const board: Board = {
    name: name.replace(/\.zip$/i, ""),
    bounds,
    layers: {},
    files: names,
    warnings: [],
  };
  if (!drills.length)
    board.warnings.push(
      "Нет файла сверловки: центры колец определяются только апертурами Gerber.",
    );
  for (const side of ["top", "bottom"] as const) {
    const file = find(
      side === "top"
        ? /\.gtl$|(?:f_cu|toplayer).*\.(gbr|ger)$/i
        : /\.gbl$|(?:b_cu|bottomlayer).*\.(gbr|ger)$/i,
    );
    if (!file) continue;
    progress(
      side === "top"
        ? "Траектории верхней стороны…"
        : "Траектории нижней стороны…",
    );
    const plot = await plotSource(source(file), false, true);
    board.layers[side] = layerPaths(plot, holes);
    board.warnings.push(...plot.warnings);
  }
  if (!Object.keys(board.layers).length)
    throw new Error("В ZIP нет медных слоёв .GTL / .GBL.");
  board.warnings = [...new Set(board.warnings)];
  return board;
}
