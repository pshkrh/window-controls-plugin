import fs from "node:fs";
import childProcess from "node:child_process";

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
const APP_PATH_LOOKUP_CACHE = new Map<string, string>();

function normalizePathString(value: any): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

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

function normalizeAppBundlePath(pathLike: any): string {
  const normalized = normalizePathString(pathLike);
  if (!normalized) return "";

  const lower = normalized.toLowerCase();
  if (lower.endsWith(".app")) return normalized;

  const marker = lower.indexOf(".app/");
  if (marker >= 0) {
    return normalized.slice(0, marker + 4);
  }

  return "";
}

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

function normalizeToAppBundlePath(pathLike: any): string {
  const normalized = normalizeAppBundlePath(pathLike);
  return normalized && fs.existsSync(normalized) ? normalized : "";
}

function cacheLookup(key: string, resolver: () => string): string {
  if (APP_PATH_LOOKUP_CACHE.has(key)) {
    return APP_PATH_LOOKUP_CACHE.get(key)!;
  }
  const value = resolver() || "";
  APP_PATH_LOOKUP_CACHE.set(key, value);
  return value;
}

function escapeMdfindValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolveAppPathByBundleIdentifier(bundleIdentifier: string): string {
  const normalized = (bundleIdentifier || "").trim();
  if (!normalized) return "";

  return cacheLookup(`bundle:${normalized}`, () => {
    const escaped = escapeMdfindValue(normalized);
    const results = runMdfind(`kMDItemCFBundleIdentifier == "${escaped}"`);
    for (const entry of results) {
      const resolved = normalizeToAppBundlePath(entry);
      if (resolved) return resolved;
    }
    return "";
  });
}

function resolveAppPathByName(appName: string): string {
  const normalizedName = (appName || "").trim();
  if (!normalizedName) return "";

  return cacheLookup(`name:${normalizedName}`, () => {
    for (const directory of COMMON_APP_DIRECTORIES) {
      const candidate = `${directory}/${normalizedName}.app`;
      const resolved = normalizeToAppBundlePath(candidate);
      if (resolved) return resolved;
    }

    const escaped = escapeMdfindValue(normalizedName);
    const results = runMdfind(
      `kMDItemKind == "Application" && (kMDItemDisplayName == "${escaped}" || kMDItemFSName == "${escaped}.app")`
    );
    for (const entry of results) {
      const resolved = normalizeToAppBundlePath(entry);
      if (resolved) return resolved;
    }
    return "";
  });
}

function extractAppPath(app: any): string {
  for (const field of APP_PATH_FIELDS) {
    const resolved = normalizeToAppBundlePath(app?.[field]);
    if (resolved) return resolved;
  }

  for (const field of APP_IDENTIFIER_FIELDS) {
    const value = app?.[field];
    if (typeof value === "string" && value.trim()) {
      const resolved = resolveAppPathByBundleIdentifier(value);
      if (resolved) return resolved;
    }
  }

  for (const field of APP_NAME_FIELDS) {
    const value = app?.[field];
    if (typeof value === "string" && value.trim()) {
      const resolved = resolveAppPathByName(value);
      if (resolved) return resolved;
    }
  }

  return "";
}

function appNameFromPath(appPath: string): string {
  const last = appPath.split("/").filter(Boolean).pop() || "";
  return last.replace(/\.app$/i, "") || "Unknown App";
}

function extractAppName(app: any, appPath: string): string {
  const directNames = APP_NAME_FIELDS.map((field) => app?.[field]);
  for (const value of directNames) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  if (appPath) {
    return appNameFromPath(appPath);
  }

  return "Unknown App";
}

function normalizeAppPath(windowRef: any): string {
  const app = windowRef?.application || {};
  return extractAppPath(app);
}

function normalizeAppName(windowRef: any): string {
  const app = windowRef?.application || {};
  const appPath = extractAppPath(app);
  return extractAppName(app, appPath);
}

function normalizeAppKey(windowRef: any): string {
  const app = windowRef?.application || {};
  const appPath = extractAppPath(app);
  const appName = extractAppName(app, appPath);
  if (appPath) return `path:${appPath}`;
  if (appName && appName !== "Unknown App") return `name:${appName}`;
  return "unknown";
}

function isValidBounds(bounds: any): boolean {
  if (!bounds) return false;
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return false;
  if (bounds.width < 120 || bounds.height < 80) return false;
  return true;
}

function shouldIncludeWindow(windowRef: any): boolean {
  const app = windowRef?.application || {};
  const appPath = extractAppPath(app);
  const appName = extractAppName(app, appPath);
  if (!appPath && appName === "Unknown App") return false;

  if (windowRef?.isMinimized === true) return false;
  if (windowRef?.isHidden === true) return false;
  if (windowRef?.isVisible === false) return false;
  if (windowRef?.isOnScreen === false) return false;

  return isValidBounds(windowRef?.bounds);
}

function dedupeWindowKey(windowRef: any): string {
  const app = windowRef?.application || {};
  const appPath = extractAppPath(app);
  const appName = extractAppName(app, appPath);
  const bounds = windowRef?.bounds || {};
  const quantize = (value: any) => Math.round((Number.isFinite(value) ? value : 0) / 8);
  const x = quantize(bounds.x);
  const y = quantize(bounds.y);
  const w = quantize(bounds.width);
  const h = quantize(bounds.height);
  return `${appPath}|${appName}|${x},${y},${w},${h}`;
}

function getDisplayBadge(flags: { has1: boolean; has2: boolean }): string {
  if (flags.has1 && flags.has2) return "1+2";
  if (flags.has1) return "1";
  if (flags.has2) return "2";
  return "";
}

export function aggregateApps(windows: any[], displayMap: any) {
  const windowList = Array.isArray(windows) ? windows : [];
  const grouped = new Map();
  const seenWindows = new Set<string>();

  for (const windowRef of windowList) {
    if (!shouldIncludeWindow(windowRef)) {
      continue;
    }

    const signature = dedupeWindowKey(windowRef);
    if (seenWindows.has(signature)) {
      continue;
    }
    seenWindows.add(signature);

    const appName = normalizeAppName(windowRef);
    const appPath = normalizeAppPath(windowRef);
    const key = normalizeAppKey(windowRef);

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        appName,
        appPath,
        windows: [],
        screenIds: new Set<string>(),
        badges: { has1: false, has2: false },
      });
    }

    const entry = grouped.get(key);
    entry.windows.push(windowRef);

    const screen = displayMap.findScreenForBounds(windowRef?.bounds || null);
    if (screen) {
      entry.screenIds.add(String(screen.id));
      const badge = displayMap.getBadgeForScreenId(screen.id);
      if (badge.includes("1")) entry.badges.has1 = true;
      if (badge.includes("2")) entry.badges.has2 = true;
    }
  }

  const apps = [];
  for (const entry of grouped.values()) {
    apps.push({
      appKey: entry.key,
      appName: entry.appName,
      appPath: entry.appPath,
      windows: entry.windows,
      windowCount: entry.windows.length,
      displayBadge: getDisplayBadge(entry.badges),
      screenIds: Array.from(entry.screenIds.values()),
    });
  }

  apps.sort((a, b) => {
    const nameCompare = a.appName.localeCompare(b.appName, undefined, { sensitivity: "base" });
    if (nameCompare !== 0) return nameCompare;
    return a.appPath.localeCompare(b.appPath);
  });

  return apps;
}
