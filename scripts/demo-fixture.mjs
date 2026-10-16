import { zipSync, strToU8 } from "fflate";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const demoProfile = {
  settings: {
    language: "ru",
    printerName: "K1 SE",
    host: "127.0.0.1",
    username: "root",
    password: "",
    drawing: {
      contactZ: 15.8,
      lift: 1,
      drawSpeed: 10,
      travelSpeed: 30,
      frame: true,
    },
    strokeWidth: 0.5,
    showTravel: true,
  },
  encryptedPassword: "",
  corners: { fl: [50, 50], fr: [160, 50], rr: [160, 130], rl: [50, 130] },
  job: null,
  hostKeys: {},
};
/** Original synthetic artwork, safe to redistribute and use in screenshots. */
export async function createDemoGerber() {
  const header =
    "%FSLAX34Y34*%\n%MOMM*%\n%ADD10C,0.45*%\n%ADD11C,2.8*%\n%ADD12C,4*%\nG01*\nD10*\n";
  const coord = (x, y, d) =>
    `X${Math.round(x * 10000)}Y${Math.round(y * 10000)}D0${d}*\n`;
  const path = (points) =>
    points.map(([x, y], i) => coord(x, y, i ? 1 : 2)).join("");
  const layer = (bottom) => {
    let out = header;
    for (let i = 0; i < 8; i++) {
      const x = 30 + i * 5,
        y = bottom ? 45 : 25;
      const endX = bottom ? 90 : 10,
        endY = 10 + i * 7;
      out += "D11*\n" + coord(x, y, 3) + coord(endX, endY, 3) + "D10*\n";
      out += path([
        [x, y],
        [x, y + (bottom ? 6 : -6)],
        [endX + (bottom ? -10 : 10), endY],
        [endX, endY],
      ]);
    }
    out += "D12*\n";
    for (const p of [
      [5, 5],
      [95, 5],
      [95, 65],
      [5, 65],
    ])
      out += coord(...p, 3);
    return out + "M02*\n";
  };
  await mkdir(".artifacts", { recursive: true });
  const file = resolve(".artifacts/PCB-Marker-Demo.zip");
  let drill = "M48\nMETRIC,TZ\nT01C0.9\nT02C2.0\n%\nG90\nT01\n";
  for (let i = 0; i < 8; i++) {
    for (const [x, y] of [
      [30 + i * 5, 25],
      [30 + i * 5, 45],
      [10, 10 + i * 7],
      [90, 10 + i * 7],
    ])
      drill += `X${x.toFixed(3)}Y${y.toFixed(3)}\n`;
  }
  drill +=
    "T02\nX5.000Y5.000\nX95.000Y5.000\nX95.000Y65.000\nX5.000Y65.000\nM30\n";
  await writeFile(
    file,
    zipSync({
      "board.GKO": strToU8(
        header +
          path([
            [0, 0],
            [100, 0],
            [100, 70],
            [0, 70],
            [0, 0],
          ]) +
          "M02*",
      ),
      "top.GTL": strToU8(layer(false)),
      "bottom.GBL": strToU8(layer(true)),
      "holes.DRL": strToU8(drill),
    }),
  );
  return file;
}
