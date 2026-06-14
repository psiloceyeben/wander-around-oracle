// Electron main process — wraps the Vite-built frontend.

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// Only these hosts may be opened in the system browser (mint checkout,
// the ensouled roster). Everything else is denied — no arbitrary nav.
const EXTERNAL_ALLOW = /^(https:\/\/)([a-z0-9-]+\.)*(ensouledagents\.com|wanderaround\.io|stripe\.com|checkout\.stripe\.com)(\/|$)/i;
function openExternalSafe(url) {
  try {
    if (typeof url === "string" && EXTERNAL_ALLOW.test(url)) {
      shell.openExternal(url);
      return true;
    }
  } catch (_) { /* ignore */ }
  return false;
}

const isDev = process.env.WANDER_DEV === "1";
const FRONTEND_DIST = isDev
  ? null
  : (
      fs.existsSync(path.join(process.resourcesPath, "frontend-dist", "index.html"))
        ? path.join(process.resourcesPath, "frontend-dist")
        : path.join(__dirname, "..", "frontend", "dist")
    );

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0d1117",
    title: "Wander Around",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, "icon.png"),
    show: false,
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173/");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(FRONTEND_DIST, "index.html");
    if (!fs.existsSync(indexPath)) {
      console.error("Frontend bundle not found at " + indexPath);
      console.error("Run `cd frontend && npm run build` first.");
      app.quit();
      return;
    }
    win.loadFile(indexPath);
  }

  // Route window.open(checkoutUrl) to the system browser; deny in-app popups.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });
  // Keep the game window on the app itself — external links go to the browser.
  win.webContents.on("will-navigate", (e, url) => {
    const here = win.webContents.getURL();
    if (url !== here && /^https?:/i.test(url)) {
      e.preventDefault();
      openExternalSafe(url);
    }
  });

  win.once("ready-to-show", () => win.show());

  win.on("closed", () => {
    /* main process cleanup */
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// IPC for future native features (file save dialogs, etc.)
ipcMain.handle("wander:get-version", () => app.getVersion());
// Explicit external-open channel — the mint panel calls this to launch the
// Stripe-hosted checkout / the agent's new home in the system browser.
ipcMain.handle("wander:open-external", (_e, url) => openExternalSafe(url));
