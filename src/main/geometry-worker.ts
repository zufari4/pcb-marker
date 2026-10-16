import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { readBoard } from "../core/gerber";
async function run() {
  const data = await readFile(workerData.path);
  if (data.length > 64 * 1024 * 1024) throw new Error("ZIP больше 64 МБ.");
  const board = await readBoard(data, basename(workerData.path), (stage) =>
    parentPort!.postMessage({ stage }),
  );
  parentPort!.postMessage({ board });
}
run().catch((error) =>
  parentPort!.postMessage({
    error: error instanceof Error ? error.message : String(error),
  }),
);
