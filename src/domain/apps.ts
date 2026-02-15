import { extractAppName, extractBestInstalledAppPath } from "./app-utils";

function isValidBounds(bounds: any): boolean {
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

function shouldIncludeWindow(windowRef: any, appPath: string, appName: string): boolean {
  if (!appPath && appName === "Unknown App") {
    return false;
  }

  if (windowRef?.isMinimized === true) {
    return false;
  }

  if (windowRef?.isHidden === true) {
    return false;
  }

  if (windowRef?.isVisible === false) {
    return false;
  }

  if (windowRef?.isOnScreen === false) {
    return false;
  }

  return isValidBounds(windowRef?.bounds);
}

function quantize(value: any): number {
  return Math.round((Number.isFinite(value) ? value : 0) / 8);
}

function createWindowSignature(appPath: string, appName: string, bounds: any): string {
  return `${appPath}|${appName}|${quantize(bounds?.x)},${quantize(bounds?.y)},${quantize(bounds?.width)},${quantize(bounds?.height)}`;
}

function getDisplayBadge(flags: { has1: boolean; has2: boolean }): string {
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

function describeWindow(windowRef: any) {
  const app = windowRef?.application || {};
  const appPath = extractBestInstalledAppPath(app);
  const appName = extractAppName(app, appPath, "Unknown App");

  return {
    appPath,
    appName,
    appKey: appPath ? `path:${appPath}` : appName !== "Unknown App" ? `name:${appName}` : "unknown",
    bounds: windowRef?.bounds || null,
    windowRef,
  };
}

export function aggregateApps(windows: any[], displayMap: any) {
  const windowList = Array.isArray(windows) ? windows : [];
  const grouped = new Map();
  const seenWindows = new Set<string>();

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
        screenIds: new Set<string>(),
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
