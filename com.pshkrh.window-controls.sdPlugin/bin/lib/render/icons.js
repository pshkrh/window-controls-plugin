"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const TRANSPARENT_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sJd7s8AAAAASUVORK5CYII=";
const ICON_THEME_VERSION = "v5";
const APP_PATH_BY_NAME_CACHE = new Map();
const COMMON_APP_DIRECTORIES = [
  "/Applications",
  "/System/Applications",
  "/System/Applications/Utilities",
  `${process.env.HOME || ""}/Applications`,
].filter(Boolean);

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

function escapeMdfindValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeAppPath(pathLike) {
  if (typeof pathLike !== "string") {
    return "";
  }

  const trimmed = pathLike.trim();
  if (!trimmed) {
    return "";
  }

  const lower = trimmed.toLowerCase();
  if (lower.endsWith(".app")) {
    return fs.existsSync(trimmed) ? trimmed : "";
  }

  const marker = lower.indexOf(".app/");
  if (marker >= 0) {
    const bundlePath = trimmed.slice(0, marker + 4);
    return fs.existsSync(bundlePath) ? bundlePath : "";
  }

  return "";
}

function resolveAppPathByName(appName) {
  const normalizedName = typeof appName === "string" ? appName.trim() : "";
  if (!normalizedName) {
    return "";
  }

  if (APP_PATH_BY_NAME_CACHE.has(normalizedName)) {
    return APP_PATH_BY_NAME_CACHE.get(normalizedName);
  }

  let resolved = "";

  for (const directory of COMMON_APP_DIRECTORIES) {
    const candidate = path.join(directory, `${normalizedName}.app`);
    if (fs.existsSync(candidate)) {
      resolved = candidate;
      break;
    }
  }

  if (!resolved) {
    try {
      const escapedName = escapeMdfindValue(normalizedName);
      const output = childProcess.execFileSync(
        "mdfind",
        [`kMDItemKind == "Application" && (kMDItemDisplayName == "${escapedName}" || kMDItemFSName == "${escapedName}.app")`],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
      const matches = String(output)
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const candidate of matches) {
        const normalized = normalizeAppPath(candidate);
        if (normalized) {
          resolved = normalized;
          break;
        }
      }
    } catch {
      // no-op
    }
  }

  APP_PATH_BY_NAME_CACHE.set(normalizedName, resolved);
  return resolved;
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
      const resolvedPath = safePath || resolveAppPathByName(safeAppName);
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
      const resolvedPath = safePath || resolveAppPathByName(safeAppName);
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
      childProcess.execFile("python3", [rendererScriptPath, "app", resolvedPath, safeBadge, safeSelected, cacheFile], {
        stdio: "ignore",
      }, () => {
        appImagePending.delete(cacheKey);
        if (fs.existsSync(cacheFile)) {
          try {
            const dataUrl = toPluginImageReference(cacheFile, pluginRootDirectory);
            appImageCache.set(cacheKey, dataUrl);
          } catch {
            // no-op
          }
        }
      });
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
