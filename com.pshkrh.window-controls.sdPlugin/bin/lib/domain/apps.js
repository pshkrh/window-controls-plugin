"use strict";

const { extractAppName, extractBestInstalledAppPath } = require("./app-utils");

function isValidBounds(bounds) {
  if (!bounds) {
    return false;
  }

  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    return false;
  }

  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    return false;
  }

  if (bounds.width < 120 || bounds.height < 80) {
    return false;
  }

  return true;
}

function shouldIncludeWindow(windowRef, appPath, appName) {
  if (!appPath && appName === "Unknown App") {
    return false;
  }

  if (windowRef && windowRef.isMinimized === true) {
    return false;
  }

  if (windowRef && windowRef.isHidden === true) {
    return false;
  }

  if (windowRef && windowRef.isVisible === false) {
    return false;
  }

  if (windowRef && windowRef.isOnScreen === false) {
    return false;
  }

  return isValidBounds(windowRef && windowRef.bounds);
}

function quantize(value) {
  return Math.round((Number.isFinite(value) ? value : 0) / 8);
}

function createWindowSignature(appPath, appName, bounds) {
  return `${appPath}|${appName}|${quantize(bounds && bounds.x)},${quantize(bounds && bounds.y)},${quantize(bounds && bounds.width)},${quantize(bounds && bounds.height)}`;
}

function getDisplayBadge(flags) {
  if (flags.has1 && flags.has2) {
    return "1+2";
  }
  if (flags.has1) {
    return "1";
  }
  if (flags.has2) {
    return "2";
  }
  return "";
}

function describeWindow(windowRef) {
  const app = (windowRef && windowRef.application) || {};
  const appPath = extractBestInstalledAppPath(app);
  const appName = extractAppName(app, appPath, "Unknown App");

  return {
    appPath,
    appName,
    appKey: appPath ? `path:${appPath}` : appName !== "Unknown App" ? `name:${appName}` : "unknown",
    bounds: (windowRef && windowRef.bounds) || null,
    windowRef,
  };
}

function aggregateApps(windows, displayMap) {
  const windowList = Array.isArray(windows) ? windows : [];
  const grouped = new Map();
  const seenWindows = new Set();

  for (const windowRef of windowList) {
    const info = describeWindow(windowRef);

    if (!shouldIncludeWindow(windowRef, info.appPath, info.appName)) {
      continue;
    }

    const signature = createWindowSignature(info.appPath, info.appName, info.bounds);
    if (seenWindows.has(signature)) {
      continue;
    }
    seenWindows.add(signature);

    if (!grouped.has(info.appKey)) {
      grouped.set(info.appKey, {
        key: info.appKey,
        appName: info.appName,
        appPath: info.appPath,
        windows: [],
        screenIds: new Set(),
        badges: { has1: false, has2: false },
      });
    }

    const entry = grouped.get(info.appKey);
    entry.windows.push(info.windowRef);

    const screen = displayMap.findScreenForBounds(info.bounds);
    if (screen) {
      entry.screenIds.add(String(screen.id));
      const badge = displayMap.getBadgeForScreenId(screen.id);
      if (badge.includes("1")) {
        entry.badges.has1 = true;
      }
      if (badge.includes("2")) {
        entry.badges.has2 = true;
      }
    }
  }

  const apps = Array.from(grouped.values(), (entry) => ({
    appKey: entry.key,
    appName: entry.appName,
    appPath: entry.appPath,
    windows: entry.windows,
    windowCount: entry.windows.length,
    displayBadge: getDisplayBadge(entry.badges),
    screenIds: Array.from(entry.screenIds.values()),
  }));

  apps.sort((a, b) => {
    const nameCompare = a.appName.localeCompare(b.appName, undefined, { sensitivity: "base" });
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return a.appPath.localeCompare(b.appPath);
  });

  return apps;
}

module.exports = {
  aggregateApps,
};
