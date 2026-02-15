"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const APP_PATH_FIELDS = [
  "path",
  "bundlePath",
  "bundleURL",
  "bundleUrl",
  "executablePath",
  "executableURL",
  "executableUrl",
  "filePath",
  "fileURL",
  "fileUrl",
  "url",
];

const APP_IDENTIFIER_FIELDS = ["bundleIdentifier", "bundleID", "bundleId", "identifier"];
const APP_NAME_FIELDS = ["name", "localizedName", "displayName"];
const COMMON_APP_DIRECTORIES = [
  "/Applications",
  "/System/Applications",
  "/System/Applications/Utilities",
  `${process.env.HOME || ""}/Applications`,
].filter(Boolean);

const APP_PATH_LOOKUP_CACHE = new Map();

function normalizePathString(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("file://")) {
    try {
      const url = new URL(trimmed);
      if (url.protocol === "file:") {
        return decodeURIComponent(url.pathname || "");
      }
    } catch {
      // Fall through to the raw string.
    }
  }

  return trimmed;
}

function normalizeAppBundlePath(pathLike) {
  const normalized = normalizePathString(pathLike);
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  if (lower.endsWith(".app")) {
    return normalized;
  }

  const marker = lower.indexOf(".app/");
  if (marker >= 0) {
    return normalized.slice(0, marker + 4);
  }

  return "";
}

function normalizeExistingAppBundlePath(pathLike) {
  const normalized = normalizeAppBundlePath(pathLike);
  return normalized && fs.existsSync(normalized) ? normalized : "";
}

function runMdfind(query) {
  try {
    const output = childProcess.execFileSync("mdfind", [query], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return String(output)
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function escapeMdfindValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function cacheLookup(key, resolver) {
  if (APP_PATH_LOOKUP_CACHE.has(key)) {
    return APP_PATH_LOOKUP_CACHE.get(key);
  }

  const value = resolver() || "";
  APP_PATH_LOOKUP_CACHE.set(key, value);
  return value;
}

function resolveInstalledAppPathByBundleIdentifier(bundleIdentifier) {
  const normalized = typeof bundleIdentifier === "string" ? bundleIdentifier.trim() : "";
  if (!normalized) {
    return "";
  }

  return cacheLookup(`bundle:${normalized}`, () => {
    const escaped = escapeMdfindValue(normalized);
    const results = runMdfind(`kMDItemCFBundleIdentifier == "${escaped}"`);

    for (const entry of results) {
      const resolved = normalizeExistingAppBundlePath(entry);
      if (resolved) {
        return resolved;
      }
    }

    return "";
  });
}

function resolveInstalledAppPathByName(appName) {
  const normalizedName = typeof appName === "string" ? appName.trim() : "";
  if (!normalizedName) {
    return "";
  }

  return cacheLookup(`name:${normalizedName}`, () => {
    for (const directory of COMMON_APP_DIRECTORIES) {
      const candidate = path.join(directory, `${normalizedName}.app`);
      const resolved = normalizeExistingAppBundlePath(candidate);
      if (resolved) {
        return resolved;
      }
    }

    const escaped = escapeMdfindValue(normalizedName);
    const results = runMdfind(
      `kMDItemKind == "Application" && (kMDItemDisplayName == "${escaped}" || kMDItemFSName == "${escaped}.app")`
    );

    for (const entry of results) {
      const resolved = normalizeExistingAppBundlePath(entry);
      if (resolved) {
        return resolved;
      }
    }

    return "";
  });
}

function extractDirectAppPath(app) {
  for (const field of APP_PATH_FIELDS) {
    const resolved = normalizeAppBundlePath(app ? app[field] : undefined);
    if (resolved) {
      return resolved;
    }
  }

  return "";
}

function extractExistingAppPath(app) {
  for (const field of APP_PATH_FIELDS) {
    const resolved = normalizeExistingAppBundlePath(app ? app[field] : undefined);
    if (resolved) {
      return resolved;
    }
  }

  return "";
}

function extractBestInstalledAppPath(app) {
  const direct = extractExistingAppPath(app);
  if (direct) {
    return direct;
  }

  for (const field of APP_IDENTIFIER_FIELDS) {
    const value = app ? app[field] : undefined;
    if (typeof value === "string" && value.trim()) {
      const resolved = resolveInstalledAppPathByBundleIdentifier(value);
      if (resolved) {
        return resolved;
      }
    }
  }

  for (const field of APP_NAME_FIELDS) {
    const value = app ? app[field] : undefined;
    if (typeof value === "string" && value.trim()) {
      const resolved = resolveInstalledAppPathByName(value);
      if (resolved) {
        return resolved;
      }
    }
  }

  return "";
}

function appNameFromPath(appPath) {
  const last = String(appPath || "")
    .split("/")
    .filter(Boolean)
    .pop() || "";
  return last.replace(/\.app$/i, "") || "Unknown App";
}

function extractAppName(app, appPath = "", unknownFallback = "") {
  for (const field of APP_NAME_FIELDS) {
    const value = app ? app[field] : undefined;
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  if (appPath) {
    return appNameFromPath(appPath);
  }

  return unknownFallback;
}

module.exports = {
  APP_PATH_FIELDS,
  extractAppName,
  extractBestInstalledAppPath,
  extractDirectAppPath,
  normalizeAppBundlePath,
  normalizeExistingAppBundlePath,
  resolveInstalledAppPathByName,
};
