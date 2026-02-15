"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const { resolveInstalledAppPathByName } = require("../domain/app-utils");

const TRANSPARENT_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sJd7s8AAAAASUVORK5CYII=";
const ICON_THEME_VERSION = "v5";

function toDataUrl(pngPath) {
  const buffer = fs.readFileSync(pngPath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function toPluginImageReference(pngPath, pluginRootDirectory) {
  return toDataUrl(pngPath);
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function createHash(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function runRendererScript(rendererScriptPath, args) {
  childProcess.execFileSync("python3", [rendererScriptPath, ...args], {
    stdio: "ignore",
  });
}

function createIconRenderer(options) {
  const cacheDirectory = options.cacheDirectory;
  const rendererScriptPath = options.rendererScriptPath;
  const pluginRootDirectory = options.pluginRootDirectory || "";
  const appImageCache = new Map();
  const controlImageCache = new Map();
  const appImagePending = new Set();

  ensureDirectory(cacheDirectory);

  return {
    transparentImage: TRANSPARENT_PNG_DATA_URL,
    getAppIconDataUrl(appPath, badgeText, selected = false, allowGenerate = true, appName = "") {
      const safePath = appPath || "";
      const safeAppName = appName || "";
      const resolvedPath = safePath || resolveInstalledAppPathByName(safeAppName);
      const safeBadge = badgeText || "";
      const safeSelected = selected ? "1" : "0";
      const cacheKey = `${resolvedPath}|${safeAppName}|${safeBadge}|${safeSelected}`;

      if (appImageCache.has(cacheKey)) {
        return appImageCache.get(cacheKey);
      }

      if (appImagePending.has(cacheKey)) {
        return null;
      }

      const cacheFile = path.join(cacheDirectory, `${createHash(`app:${ICON_THEME_VERSION}:${cacheKey}`)}.png`);
      if (!fs.existsSync(cacheFile)) {
        if (!allowGenerate) {
          return null;
        }

        try {
          appImagePending.add(cacheKey);
          runRendererScript(rendererScriptPath, ["app", resolvedPath, safeBadge, safeSelected, cacheFile]);
        } catch {
          return null;
        } finally {
          appImagePending.delete(cacheKey);
        }
      }

      let dataUrl;
      try {
        dataUrl = toPluginImageReference(cacheFile, pluginRootDirectory);
      } catch {
        return null;
      }
      appImageCache.set(cacheKey, dataUrl);
      return dataUrl;
    },
    prewarmAppIcon(appPath, badgeText, selected = false, appName = "") {
      const safePath = appPath || "";
      const safeAppName = appName || "";
      const resolvedPath = safePath || resolveInstalledAppPathByName(safeAppName);
      const safeBadge = badgeText || "";
      const safeSelected = selected ? "1" : "0";
      const cacheKey = `${resolvedPath}|${safeAppName}|${safeBadge}|${safeSelected}`;

      if (appImageCache.has(cacheKey)) {
        return;
      }

      const cacheFile = path.join(cacheDirectory, `${createHash(`app:${ICON_THEME_VERSION}:${cacheKey}`)}.png`);
      if (fs.existsSync(cacheFile)) {
        try {
          const dataUrl = toPluginImageReference(cacheFile, pluginRootDirectory);
          appImageCache.set(cacheKey, dataUrl);
        } catch {
          // no-op
        }
        return;
      }

      if (appImagePending.has(cacheKey)) {
        return;
      }

      appImagePending.add(cacheKey);
      childProcess.execFile(
        "python3",
        [rendererScriptPath, "app", resolvedPath, safeBadge, safeSelected, cacheFile],
        {
          stdio: "ignore",
        },
        () => {
          appImagePending.delete(cacheKey);
          if (fs.existsSync(cacheFile)) {
            try {
              const dataUrl = toPluginImageReference(cacheFile, pluginRootDirectory);
              appImageCache.set(cacheKey, dataUrl);
            } catch {
              // no-op
            }
          }
        }
      );
    },
    hasPendingAppIcons() {
      return appImagePending.size > 0;
    },
    getControlIconDataUrl(role, label) {
      const safeRole = role || "control";
      const safeLabel = label || "";
      const cacheKey = `${safeRole}|${safeLabel}`;

      if (controlImageCache.has(cacheKey)) {
        return controlImageCache.get(cacheKey);
      }

      const cacheFile = path.join(cacheDirectory, `${createHash(`control:${ICON_THEME_VERSION}:${cacheKey}`)}.png`);
      if (!fs.existsSync(cacheFile)) {
        try {
          runRendererScript(rendererScriptPath, ["control", safeRole, safeLabel, cacheFile]);
        } catch {
          return TRANSPARENT_PNG_DATA_URL;
        }
      }

      const dataUrl = toPluginImageReference(cacheFile, pluginRootDirectory);
      controlImageCache.set(cacheKey, dataUrl);
      return dataUrl;
    },
  };
}

module.exports = {
  TRANSPARENT_PNG_DATA_URL,
  createIconRenderer,
};
