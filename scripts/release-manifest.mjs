import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
export async function releaseManifest(directory) {
  const files = (await readdir(directory))
    .filter((file) => /\.(exe|zip)$/.test(file))
    .sort();
  if (
    !files.some((file) => file.endsWith(".exe")) ||
    !files.some((file) => file.endsWith(".zip"))
  )
    throw new Error("Installer or ZIP missing");
  const lines = await Promise.all(
    files.map(
      async (file) =>
        `${createHash("sha256")
          .update(await readFile(join(directory, file)))
          .digest("hex")}  ${file}`,
    ),
  );
  await writeFile(join(directory, "SHA256SUMS.txt"), lines.join("\n") + "\n");
}
