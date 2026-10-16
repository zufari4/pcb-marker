import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
await build({
  entryPoints: [
    "src/main/index.ts",
    "src/main/preload.ts",
    "src/main/geometry-worker.ts",
  ],
  outdir: "dist/main",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron", "ssh2"],
  sourcemap: true,
});
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const queue = [
    {
      directory: process.cwd(),
      names: [
        ...Object.keys(metadata.dependencies),
        "fflate",
        "gerber-parser",
        "gerber-plotter",
        "jsts",
        "lucide-react",
        "react",
        "react-dom",
        "zod",
      ],
    },
  ],
  seen = new Set();
while (queue.length) {
  const { directory, names } = queue.pop();
  const require = createRequire(join(directory, "package.json"));
  for (const name of names) {
    let packagePath;
    try {
      packagePath = require.resolve(name + "/package.json");
    } catch {
      continue;
    }
    if (seen.has(packagePath)) continue;
    seen.add(packagePath);
    const pkg = JSON.parse(await readFile(packagePath, "utf8")),
      root = dirname(packagePath);
    const target = join(
      "dist/licenses",
      pkg.name.replaceAll("/", "_") + "-" + pkg.version,
    );
    await mkdir(target, { recursive: true });
    await writeFile(
      join(target, "package.json"),
      JSON.stringify(
        {
          name: pkg.name,
          version: pkg.version,
          license: pkg.license,
          repository: pkg.repository,
        },
        null,
        2,
      ),
    );
    for (const file of await readdir(root))
      if (/^(license|copying|notice)/i.test(file))
        await cp(join(root, file), join(target, file), { recursive: true });
    queue.push({ directory: root, names: Object.keys(pkg.dependencies ?? {}) });
  }
}
await cp("licenses", "dist/licenses/extra", { recursive: true });

await cp("assets", "dist/assets", { recursive: true });
