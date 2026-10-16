import "jsts/org/locationtech/jts/monkey.js";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import MinimumDiameter from "jsts/org/locationtech/jts/algorithm/MinimumDiameter.js";
import GeometryPrecisionReducer from "jsts/org/locationtech/jts/precision/GeometryPrecisionReducer.js";
import PrecisionModel from "jsts/org/locationtech/jts/geom/PrecisionModel.js";
import MCIndexSnapRounder from "jsts/org/locationtech/jts/noding/snapround/MCIndexSnapRounder.js";
import NodedSegmentString from "jsts/org/locationtech/jts/noding/NodedSegmentString.js";
import ArrayList from "jsts/java/util/ArrayList.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import type { XY } from "../shared/model";

/** Small typed boundary around JSTS's dynamically extended geometry API. */
export interface Geometry {
  getGeometryType(): string;
  isEmpty(): boolean;
  getNumGeometries(): number;
  getGeometryN(i: number): Geometry;
  getCoordinates(): { x: number; y: number }[];
  getExteriorRing(): Geometry;
  getNumInteriorRing(): number;
  getInteriorRingN(i: number): Geometry;
  getBoundary(): Geometry;
  getCentroid(): Geometry;
  getInteriorPoint(): Geometry;
  getLength(): number;
  getEnvelopeInternal(): {
    getMinX(): number;
    getMinY(): number;
    getMaxX(): number;
    getMaxY(): number;
  };
  buffer(radius: number, segments?: number): Geometry;
  union(other: Geometry): Geometry;
  difference(other: Geometry): Geometry;
  intersection(other: Geometry): Geometry;
  covers(other: Geometry): boolean;
  distance(other: Geometry): number;
}
const reader = new GeoJSONReader(new GeometryFactory());
export const readGeometry = (json: unknown): Geometry =>
  reader.read(json) as unknown as Geometry;
export const empty = () =>
  readGeometry({ type: "GeometryCollection", geometries: [] });
export const point = (p: XY) => readGeometry({ type: "Point", coordinates: p });
export const line = (p: XY[]) =>
  p.length === 1
    ? point(p[0])
    : readGeometry({ type: "LineString", coordinates: p });
export function polygon(p: XY[]): Geometry {
  if (p.length < 3) return empty();
  const closed = [...p];
  if (p[0][0] !== p.at(-1)![0] || p[0][1] !== p.at(-1)![1]) closed.push(p[0]);
  return readGeometry({ type: "Polygon", coordinates: [closed] });
}
export const coords = (g: Geometry): XY[] =>
  g.getCoordinates().map((p) => [p.x, p.y]);
export function parts(g: Geometry, kind: string): Geometry[] {
  if (g.isEmpty()) return [];
  if (g.getGeometryType() === kind) return [g];
  if (
    g.getGeometryType().startsWith("Multi") ||
    g.getGeometryType() === "GeometryCollection"
  )
    return Array.from({ length: g.getNumGeometries() }, (_, i) =>
      parts(g.getGeometryN(i), kind),
    ).flat();
  return [];
}
export function union(items: Geometry[]): Geometry {
  if (!items.length) return empty();
  // Build a collection without serializing thousands of circular polygons.
  const factory = (
    items[0] as unknown as {
      getFactory(): { createGeometryCollection(a: Geometry[]): Geometry };
    }
  ).getFactory();
  return UnaryUnionOp.union(
    factory.createGeometryCollection(items),
  ) as unknown as Geometry;
}
export const snap = (g: Geometry) =>
  GeometryPrecisionReducer.reduce(
    g,
    new PrecisionModel(1e7),
  ) as unknown as Geometry;
export function nodedLines(paths: XY[][]): XY[][] {
  const strings = new ArrayList(undefined);
  // One nanometre grid only resolves overlay roundoff, never PCB clearances.
  for (const path of paths)
    strings.add(
      new NodedSegmentString(
        path.map(
          (p) =>
            new Coordinate(
              Math.round(p[0] * 1e6) / 1e6,
              Math.round(p[1] * 1e6) / 1e6,
            ),
        ),
        null,
      ),
    );
  const noder = new MCIndexSnapRounder(new PrecisionModel(1e6));
  noder.computeNodes(strings);
  return noder
    .getNodedSubstrings()
    .toArray()
    .map((s: NodedSegmentString) =>
      s.getCoordinates().map((p: { x: number; y: number }) => [p.x, p.y]),
    );
}
export const minimumRectangle = (g: Geometry) =>
  MinimumDiameter.getMinimumRectangle(g) as unknown as Geometry;
export function outlineBounds(
  edges: Geometry[],
): [number, number, number, number] {
  const polygonizer = new Polygonizer();
  polygonizer.add(union(edges));
  const polygons = polygonizer.getPolygons().toArray() as Geometry[];
  if (!polygons.length)
    throw new Error("В Gerber нет замкнутого контура платы.");
  const e = union(polygons).getEnvelopeInternal();
  return [e.getMinX(), e.getMinY(), e.getMaxX(), e.getMaxY()];
}
