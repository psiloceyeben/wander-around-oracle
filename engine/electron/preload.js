// Electron preload — exposes a minimal `wanderNative` API to the renderer.
// Future expansion: file dialogs, screenshot save, settings persistence.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wanderNative", {
  getVersion: () => ipcRenderer.invoke("wander:get-version"),
  openExternal: (url) => ipcRenderer.invoke("wander:open-external", url),
  platform: process.platform,
  arch: process.arch,
});
