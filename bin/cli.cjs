#!/usr/bin/env node
const { spawn } = require("node:child_process");
const path = require("node:path");
const metadata = require("../package.json");
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(metadata.version);
  process.exit(0);
}
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    "PCB Marker — desktop Gerber marker plotter\n\nUsage: pcb-marker [board.zip]\n       pcb-marker --version\n\nhttps://github.com/zufari4/pcb-marker",
  );
  process.exit(0);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  require("electron"),
  [path.join(__dirname, ".."), ...process.argv.slice(2)],
  { stdio: "inherit", env },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
