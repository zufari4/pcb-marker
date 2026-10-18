export type XY = [number, number];
export type XYZ = [number, number, number];
export interface MotionLimits {
  min: XYZ;
  max: XYZ;
}
export type Side = "top" | "bottom";
export type LayerView = Side | "both";
export type CornerKey = "fl" | "fr" | "rr" | "rl";
export type Corners = Partial<Record<CornerKey, XY>>;
export type Bounds = [number, number, number, number];
export interface Stroke {
  points: XY[];
  kind: "track" | "pad" | "frame";
}
export interface BoardLayer {
  strokes: Stroke[];
  /** Pad outlines for display, separate from the connected drawing route. */
  padStrokes?: Stroke[];
  trackCount: number;
  padCount: number;
}
export interface Board {
  name: string;
  bounds: Bounds;
  layers: Partial<Record<Side, BoardLayer>>;
  files: string[];
  warnings: string[];
}
export interface DrawingSettings {
  contactZ: number;
  lift: number;
  drawSpeed: number;
  travelSpeed: number;
  zLiftSpeed: number;
  zLowerSpeed: number;
  frame: boolean;
}
export interface Settings {
  language: "system" | "ru" | "en";
  printerName: string;
  host: string;
  username: string;
  password: string;
  drawing: DrawingSettings;
  strokeWidth: number;
  showTravel: boolean;
}
export interface Registration {
  center: XY;
  angle: number;
  width: number;
  height: number;
  residual: number;
}
export type Operation = "draw" | "travel" | "lift" | "lower" | "idle";
export interface Motion {
  /** Follows board artwork, including when the marker is raised for a dry run. */
  path?: boolean;
  from: XYZ;
  to: XYZ;
  operation: Operation;
  start: number;
  end: number;
  /** Command start offset; older saved jobs contain only byteEnd. */
  byteStart?: number;
  byteEnd: number;
}
export interface Program {
  gcode: string;
  motions: Motion[];
  duration: number;
  returnPosition: XYZ;
  travelZ: number;
  /** Optional for jobs saved before configurable Z speeds were introduced. */
  zLiftSpeed?: number;
  zLowerSpeed?: number;
  side: Side;
  dry: boolean;
}
export interface PrinterStatus {
  connected: boolean;
  homed: string;
  position: XYZ;
  positionSource?: "live" | "commanded";
  /** Travel limits expressed in the same G-code coordinates as position. */
  limits?: MotionLimits;
  state: string;
  filename: string;
  progress: number;
  filePosition: number;
  paused: boolean;
  nozzle: number;
  bed: number;
  nozzleTarget: number;
  bedTarget: number;
  idle: string;
  message: string;
}
export type JobState =
  | "preparing"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "error"
  | "disconnected";
export interface Job {
  id: string;
  filename: string;
  boardName: string;
  state: JobState;
  program: Program;
  error?: string;
  startedAt: string;
}
export interface AppSnapshot {
  settings: Settings;
  systemLocale: string;
  corners: Corners;
  board: Board | null;
  printer: PrinterStatus | null;
  job: Job | null;
  recentFile?: string;
}
export interface LoadProgress {
  stage: string;
  busy: boolean;
}
export interface Api {
  checkUpdates(): Promise<import("./project").UpdateResult>;
  openProjectPage(page: "repository" | "releases" | "issues"): Promise<void>;
  snapshot(): Promise<AppSnapshot>;
  saveSettings(settings: Settings): Promise<Settings>;
  openBoard(): Promise<Board | null>;
  dropBoard(file: File): Promise<Board | null>;
  cancelLoad(): Promise<void>;
  connect(): Promise<PrinterStatus>;
  readContactZ(): Promise<number>;
  captureCorner(key: CornerKey): Promise<Corners>;
  resetCorners(): Promise<Corners>;
  startJob(side: Side, dry: boolean): Promise<Job>;
  controlJob(action: "pause" | "resume" | "stop"): Promise<Job>;
  exportGcode(side: Side, dry: boolean): Promise<string | null>;
  window(action: "minimize" | "maximize" | "close" | "confirm-close"): void;
  onError(callback: (message: string) => void): () => void;
  onCloseRequest(callback: () => void): () => void;
  onStatus(callback: (status: PrinterStatus) => void): () => void;
  onJob(callback: (job: Job) => void): () => void;
  onLoad(callback: (progress: LoadProgress) => void): () => void;
  onBoard(callback: (board: Board) => void): () => void;
}
declare global {
  interface Window {
    pcb: Api;
  }
}
