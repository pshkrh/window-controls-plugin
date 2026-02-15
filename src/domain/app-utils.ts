import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";

export const APP_PATH_FIELDS = [
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

const APP_PATH_LOOKUP_CACHE = new Map<string, string>();

function runMdfind(query: string): string[] {
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

function escapeMdfindValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function cacheLookup(key: string, resolver: () => string): string {
  if (APP_PATH_LOOKUP_CACHE.has(key)) {
    return APP_PATH_LOOKUP_CACHE.get(key)!;
  }

  const value = resolver() || "";
  APP_PATH_LOOKUP_CACHE.set(key, value);
  return value;
}

export function normalizePathString(value: any): string {
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

export function normalizeAppBundlePath(pathLike: any): string {
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

export function normalizeExistingAppBundlePath(pathLike: any): string {
  const normalized = normalizeAppBundlePath(pathLike);
  return normalized && fs.existsSync(normalized) ? normalized : "";
}

export function resolveInstalledAppPathByBundleIdentifier(bundleIdentifier: string): string {
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

export function resolveInstalledAppPathByName(appName: string): string {
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

export function extractDirectAppPath(app: any): string {
  for (const field of APP_PATH_FIELDS) {
    const resolved = normalizeAppBundlePath(app?.[field]);
    if (resolved) {
      return resolved;
    }
  }

  return "";
}

function extractExistingAppPath(app: any): string {
  for (const field of APP_PATH_FIELDS) {
    const resolved = normalizeExistingAppBundlePath(app?.[field]);
    if (resolved) {
      return resolved;
    }
  }

  return "";
}

export function extractBestInstalledAppPath(app: any): string {
  const direct = extractExistingAppPath(app);
  if (direct) {
    return direct;
  }

  for (const field of APP_IDENTIFIER_FIELDS) {
    const value = app?.[field];
    if (typeof value === "string" && value.trim()) {
      const resolved = resolveInstalledAppPathByBundleIdentifier(value);
      if (resolved) {
        return resolved;
      }
    }
  }

  for (const field of APP_NAME_FIELDS) {
    const value = app?.[field];
    if (typeof value === "string" && value.trim()) {
      const resolved = resolveInstalledAppPathByName(value);
      if (resolved) {
        return resolved;
      }
    }
  }

  return "";
}

function appNameFromPath(appPath: string): string {
  const last = String(appPath || "")
    .split("/")
    .filter(Boolean)
    .pop() || "";
  return last.replace(/\.app$/i, "") || "Unknown App";
}

export function extractAppName(app: any, appPath: string = "", unknownFallback: string = ""): string {
  for (const field of APP_NAME_FIELDS) {
    const value = app?.[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  if (appPath) {
    return appNameFromPath(appPath);
  }

  return unknownFallback;
}
