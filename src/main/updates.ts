import { project, type UpdateResult } from "../shared/project";
export function newerVersion(current: string, candidate: string): boolean {
  const parse = (version: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) throw new Error("Invalid release version");
    return match.slice(1).map(Number);
  };
  const a = parse(current),
    b = parse(candidate);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i];
  return false;
}
/** Manual, read-only lookup. Downloads and installation remain user actions. */
export async function checkUpdates(
  currentVersion: string,
  request = fetch,
): Promise<UpdateResult> {
  const response = await request(project.latestReleaseApi, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `PCB-Marker/${currentVersion}`,
    },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (response.status === 404) return { status: "unpublished" };
  if (!response.ok) throw new Error("Update check failed");
  const release = await response.json();
  if (
    release.draft ||
    release.prerelease ||
    typeof release.tag_name !== "string"
  )
    throw new Error("Invalid release response");
  return {
    status: newerVersion(currentVersion, release.tag_name)
      ? "available"
      : "current",
    version: release.tag_name.replace(/^v/, ""),
  };
}
