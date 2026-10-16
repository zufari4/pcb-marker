import type { Stroke, XY } from "../shared/model";
import { line, point, union, nodedLines } from "./geometry";
import { distance } from "./registration";

const key = (p: XY) => p.map((v) => v.toFixed(7)).join(",");
interface Edge {
  a: string;
  b: string;
  points: XY[] | null;
}
/** Node all intersections, then partition each component into minimal Euler trails. */
export function connectedStrokes(strokes: Stroke[]): Stroke[] {
  const paths = strokes.filter((s) => s.points.length > 1).map((s) => s.points);
  const geometry = union(paths.map(line));
  const edges: Edge[] = [],
    adjacency = new Map<string, number[]>();
  const addEdge = (a: string, b: string, points: XY[] | null) => {
    const id = edges.push({ a, b, points }) - 1;
    for (const v of [a, b]) {
      if (!adjacency.has(v)) adjacency.set(v, []);
      adjacency.get(v)!.push(id);
    }
  };
  const segmentKeys = new Set<string>();
  for (const p of nodedLines(paths)) {
    for (let i = 1; i < p.length; i++) {
      const a = key(p[i - 1]),
        b = key(p[i]);
      if (a === b) continue;
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (segmentKeys.has(id)) continue;
      segmentKeys.add(id);
      addEdge(a, b, [p[i - 1], p[i]]);
    }
  }
  const unseen = new Set(adjacency.keys()),
    result: Stroke[] = [];
  while (unseen.size) {
    const start = unseen.values().next().value!;
    const component = new Set<string>(),
      todo = [start];
    while (todo.length) {
      const v = todo.pop()!;
      if (component.has(v)) continue;
      component.add(v);
      unseen.delete(v);
      for (const id of adjacency.get(v)!) {
        const e = edges[id];
        todo.push(e.a === v ? e.b : e.a);
      }
    }
    const odd = [...component]
      .filter((v) => adjacency.get(v)!.length % 2)
      .sort();
    for (let i = 0; i < odd.length; i += 2) addEdge(odd[i], odd[i + 1], null);
    const used = new Set<number>(),
      stack: { node: string; points: XY[] | null }[] = [
        { node: start, points: null },
      ];
    let walk: (XY[] | null)[] = [];
    while (stack.length) {
      const current = stack.at(-1)!,
        adjacent = adjacency.get(current.node)!;
      while (adjacent.length && used.has(adjacent.at(-1)!)) adjacent.pop();
      if (adjacent.length) {
        const id = adjacent.pop()!,
          e = edges[id];
        used.add(id);
        const forward = e.a === current.node;
        stack.push({
          node: forward ? e.b : e.a,
          points: !e.points || forward ? e.points : [...e.points].reverse(),
        });
      } else {
        const entry = stack.pop()!;
        if (stack.length) walk.push(entry.points);
      }
    }
    walk.reverse();
    if (odd.length) {
      const cut = walk.indexOf(null);
      walk = [...walk.slice(cut + 1), ...walk.slice(0, cut + 1)];
    }
    let points: XY[] = [];
    for (const segment of walk) {
      if (!segment) {
        if (points.length) result.push({ points, kind: "track" });
        points = [];
      } else {
        if (points.length && distance(points.at(-1)!, segment[0]) > 2e-7)
          throw new Error("Разрыв связной траектории.");
        points.push(...(points.length ? segment.slice(1) : segment));
      }
    }
    if (points.length) result.push({ points, kind: "track" });
  }
  const seenDots = new Set<string>();
  for (const s of strokes.filter((s) => s.points.length === 1)) {
    if (
      !seenDots.has(key(s.points[0])) &&
      (geometry.isEmpty() || point(s.points[0]).distance(geometry) > 1e-7)
    )
      result.push(s);
    seenDots.add(key(s.points[0]));
  }
  return orderStrokes(result);
}
export function orderStrokes(strokes: Stroke[]): Stroke[] {
  const pending = [...strokes],
    result: Stroke[] = [];
  let position: XY = [0, 0];
  while (pending.length) {
    let best = 0,
      vertex = 0,
      min = Infinity;
    for (let i = 0; i < pending.length; i++) {
      const ps = pending[i].points,
        closed = ps.length > 2 && distance(ps[0], ps.at(-1)!) < 1e-7;
      for (const j of closed
        ? ps.slice(0, -1).map((_, j) => j)
        : [0, ps.length - 1]) {
        const d = distance(position, ps[j]);
        if (d < min) {
          best = i;
          vertex = j;
          min = d;
        }
      }
    }
    const stroke = pending.splice(best, 1)[0],
      ps = stroke.points;
    const closed = ps.length > 2 && distance(ps[0], ps.at(-1)!) < 1e-7;
    const points = closed
      ? [...ps.slice(vertex, -1), ...ps.slice(0, vertex + 1)]
      : vertex
        ? [...ps].reverse()
        : ps;
    result.push({ ...stroke, points });
    position = points.at(-1)!;
  }
  return result;
}
