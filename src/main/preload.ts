import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { Api } from "../shared/model";
const subscribe = <T>(channel: string, callback: (data: T) => void) => {
  const listener = (_: Electron.IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const api: Api = {
  checkUpdates: () => ipcRenderer.invoke("app:check-updates"),
  openProjectPage: (page) => ipcRenderer.invoke("app:open-project", page),
  snapshot: () => ipcRenderer.invoke("snapshot"),
  saveSettings: (value) => ipcRenderer.invoke("settings:save", value),
  openBoard: () => ipcRenderer.invoke("board:open"),
  dropBoard: (file) =>
    ipcRenderer.invoke("board:drop", webUtils.getPathForFile(file)),
  cancelLoad: () => ipcRenderer.invoke("board:cancel"),
  connect: () => ipcRenderer.invoke("printer:connect"),
  readContactZ: () => ipcRenderer.invoke("printer:read-contact-z"),
  captureCorner: (key) => ipcRenderer.invoke("corners:capture", key),
  resetCorners: () => ipcRenderer.invoke("corners:reset"),
  startJob: (side, dry) => ipcRenderer.invoke("job:start", side, dry),
  controlJob: (action) => ipcRenderer.invoke("job:control", action),
  exportGcode: (side, dry) => ipcRenderer.invoke("gcode:export", side, dry),
  window: (action) => ipcRenderer.send("window", action),
  onError: (callback) => subscribe("app:error", callback),
  onCloseRequest: (callback) => subscribe("window:close-request", callback),
  onStatus: (callback) => subscribe("printer:status", callback),
  onJob: (callback) => subscribe("job:changed", callback),
  onLoad: (callback) => subscribe("board:progress", callback),
  onBoard: (callback) => subscribe("board:changed", callback),
};
contextBridge.exposeInMainWorld("pcb", api);
