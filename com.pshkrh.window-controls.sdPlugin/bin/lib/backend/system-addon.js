"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

function resolveAddonPath(baseDir) {
  return path.resolve(baseDir, "addon", "mac", "System.node");
}

function normalizeError(error, addonPath) {
  const wrapped = new Error(error && error.message ? error.message : String(error));
  wrapped.name = error && error.name ? error.name : "WindowBackendError";
  wrapped.cause = error;
  wrapped.addonPath = addonPath;
  return wrapped;
}

function createWindowBackend(baseDir) {
  const addonPath = resolveAddonPath(baseDir);

  if (process.platform !== "darwin") {
    throw new Error("Window Controls plugin currently supports macOS only.");
  }

  if (!fs.existsSync(addonPath)) {
    throw new Error(
      `System.node not found at ${addonPath}. Run scripts/install-window-controls.sh to copy the native backend.`
    );
  }

  let addon;
  try {
    addon = require(addonPath);
  } catch (error) {
    throw normalizeError(error, addonPath);
  }

  if (!addon || !addon.windowManager) {
    throw new Error("Invalid native addon: windowManager API is missing.");
  }

  return {
    addonPath,
    async getForegroundWindow() {
      return addon.windowManager.getForegroundWindow();
    },
    async getScreens() {
      return addon.windowManager.getScreens();
    },
    async getWindows() {
      return addon.windowManager.getWindows();
    },
    async setWindowBounds(windowRef, options) {
      return windowRef.setBounds(options);
    },
  };
}

function isPermissionError(error) {
  if (!error) {
    return false;
  }

  if (error.name === "PermissionError") {
    return true;
  }

  const message = String(error.message || "").toLowerCase();
  return message.includes("window management unavailable") || message.includes("permission");
}

function openPermissionsSettings() {
  if (process.platform !== "darwin") {
    return;
  }

  const targets = [
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  ];

  for (const target of targets) {
    childProcess.execFile("open", [target], () => {
      /* no-op */
    });
  }
}

module.exports = {
  createWindowBackend,
  isPermissionError,
  openPermissionsSettings,
};
