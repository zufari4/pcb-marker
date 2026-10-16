import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { build, Platform } from "electron-builder";
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const staging = resolve(".packaging");
if (dirname(staging) !== process.cwd())
  throw new Error("Unexpected packaging directory");
await rm(staging, { recursive: true, force: true });
await mkdir(".packaging", { recursive: true });
await cp("dist", ".packaging/dist", { recursive: true });
// Desktop packaging excludes the npm launcher/runtime dependency. The published
// npm package keeps Electron so `npm install -g` can launch the same UI.
await writeFile(
  ".packaging/package.json",
  JSON.stringify(
    {
      name: metadata.name,
      version: metadata.version,
      author: metadata.author,
      license: metadata.license,
      homepage: metadata.homepage,
      description: metadata.description,
      main: metadata.main,
      type: "module",
      dependencies: { ssh2: metadata.dependencies.ssh2 },
    },
    null,
    2,
  ),
);
for (const file of ["README.md", "THIRD_PARTY_NOTICES.md", "LICENSE"])
  await cp(file, `.packaging/${file}`);
const install = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  [
    "install",
    "--omit=dev",
    "--omit=optional",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ],
  { cwd: ".packaging", stdio: "inherit", shell: process.platform === "win32" },
);
if (install.status) process.exit(install.status);
const output = `release/build-${metadata.version}-${Date.now()}`;
const electronExecutable = createRequire(import.meta.url)("electron");
await build({
  publish: "never",
  targets: Platform.WINDOWS.createTarget(
    process.argv.includes("--release")
      ? ["nsis", "zip"]
      : process.argv.includes("--installer")
        ? "nsis"
        : "dir",
  ),
  config: {
    ...metadata.build,
    directories: { ...metadata.build.directories, output },
    electronVersion: JSON.parse(
      await readFile("node_modules/electron/package.json", "utf8"),
    ).version,
    electronDist: dirname(electronExecutable),
  },
});

const executable = `${output}/win-unpacked/PCB Marker.exe`;
if (process.argv.includes("--release")) {
  const { releaseManifest } = await import("./release-manifest.mjs");
  await releaseManifest(output);
}
await writeFile(
  "release/latest-build.json",
  JSON.stringify({ executable }, null, 2),
);
await writeFile(
  "Запустить PCB Marker.cmd",
  `@echo off

start "" "%~dp0${executable.replaceAll("/", "\\")}"

`,
);
