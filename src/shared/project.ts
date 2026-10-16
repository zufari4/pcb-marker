export const project = {
  name: "PCB Marker",
  author: "zufari",
  repository: "https://github.com/zufari4/pcb-marker",
  releases: "https://github.com/zufari4/pcb-marker/releases",
  issues: "https://github.com/zufari4/pcb-marker/issues",
  latestReleaseApi:
    "https://api.github.com/repos/zufari4/pcb-marker/releases/latest",
} as const;
export interface UpdateResult {
  status: "available" | "current" | "unpublished";
  version?: string;
}
