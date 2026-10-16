import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { readBoard } from "../src/core/gerber";
const path = process.argv[2];
const start = performance.now();
const board = await readBoard(
  await readFile(path),
  basename(path),
  console.log,
);
await mkdir(".artifacts", { recursive: true });
await writeFile(".artifacts/board.json", JSON.stringify(board));
console.log(
  JSON.stringify(
    {
      name: board.name,
      bounds: board.bounds,
      warnings: board.warnings,
      layers: Object.fromEntries(
        Object.entries(board.layers).map(([side, layer]) => [
          side,
          {
            strokes: layer!.strokes.length,
            points: layer!.strokes.reduce((sum, s) => sum + s.points.length, 0),
            tracks: layer!.trackCount,
            pads: layer!.padCount,
          },
        ]),
      ),
      seconds: (performance.now() - start) / 1000,
    },
    null,
    2,
  ),
);
