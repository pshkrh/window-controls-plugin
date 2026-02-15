"use strict";

const { getWorkArea, mapDisplays } = require("./displays");

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

function extractAppPath(app) {
  for (const field of APP_PATH_FIELDS) {
    const resolved = normalizeAppBundlePath(app ? app[field] : undefined);
    if (resolved) {
      return resolved;
    }
  }
  return "";
}

function extractAppName(app) {
  const directNames = [app && app.name, app && app.localizedName, app && app.displayName];
  for (const value of directNames) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizedRelativePosition(bounds, sourceArea) {
  const relativeX = sourceArea.width > 0 ? (bounds.x - sourceArea.x) / sourceArea.width : 0;
  const relativeY = sourceArea.height > 0 ? (bounds.y - sourceArea.y) / sourceArea.height : 0;

  return {
    x: clamp(relativeX, 0, 1),
    y: clamp(relativeY, 0, 1),
  };
}

function normalizedRelativeSize(bounds, sourceArea) {
  const relativeWidth = sourceArea.width > 0 ? bounds.width / sourceArea.width : 0;
  const relativeHeight = sourceArea.height > 0 ? bounds.height / sourceArea.height : 0;

  return {
    width: clamp(relativeWidth, 0.05, 1),
    height: clamp(relativeHeight, 0.05, 1),
  };
}

function toRelativeBounds(bounds, area) {
  return {
    x: safeNumber(bounds.x, area.x) - area.x,
    y: safeNumber(bounds.y, area.y) - area.y,
    width: safeNumber(bounds.width, 800),
    height: safeNumber(bounds.height, 600),
  };
}

function clampBoundsToArea(bounds, targetArea) {
  const width = clamp(safeNumber(bounds.width, 800), 200, Math.max(200, targetArea.width));
  const height = clamp(safeNumber(bounds.height, 600), 120, Math.max(120, targetArea.height));
  const maxX = Math.max(0, targetArea.width - width);
  const maxY = Math.max(0, targetArea.height - height);

  return {
    x: Math.round(clamp(safeNumber(bounds.x, 0), 0, maxX)),
    y: Math.round(clamp(safeNumber(bounds.y, 0), 0, maxY)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function createTargetBounds(bounds, sourceArea, targetArea) {
  const relative = normalizedRelativePosition(bounds, sourceArea);
  const relativeSize = normalizedRelativeSize(bounds, sourceArea);

  let width = safeNumber(bounds.width, 800);
  let height = safeNumber(bounds.height, 600);

  if (width > targetArea.width || height > targetArea.height) {
    width = targetArea.width * relativeSize.width;
    height = targetArea.height * relativeSize.height;
  }

  width = clamp(width, 200, Math.max(200, targetArea.width));
  height = clamp(height, 120, Math.max(120, targetArea.height));

  const maxX = Math.max(0, targetArea.width - width);
  const maxY = Math.max(0, targetArea.height - height);

  const x = Math.round(clamp(relative.x * maxX, 0, maxX));
  const y = Math.round(clamp(relative.y * maxY, 0, maxY));

  return {
    x,
    y,
    width: Math.round(width),
    height: Math.round(height),
  };
}

function matchesApp(windowRef, selectedAppPath, selectedAppName) {
  const app = (windowRef && windowRef.application) || {};
  const appPath = extractAppPath(app);
  const appName = extractAppName(app);

  if (selectedAppPath && appPath === selectedAppPath) {
    return true;
  }

  if (selectedAppName && appName === selectedAppName) {
    return true;
  }

  return false;
}

function createMoveEngine(backend) {
  const rememberedBoundsByWindow = new Map();

  function getWindowIdentity(windowRef, index) {
    const explicitId =
      windowRef && (windowRef.id ?? windowRef.windowId ?? windowRef.kCGWindowNumber ?? windowRef.cgWindowID ?? windowRef.number);
    if (explicitId !== undefined && explicitId !== null) {
      return `id:${String(explicitId)}`;
    }

    const appPath = extractAppPath((windowRef && windowRef.application) || {});
    const title = (windowRef && windowRef.title) || "";
    return `fallback:${appPath}|${title}|${index}`;
  }

  function rememberBounds(windowKey, screenId, bounds) {
    if (!windowKey || !screenId || !bounds) {
      return;
    }

    if (!rememberedBoundsByWindow.has(windowKey)) {
      rememberedBoundsByWindow.set(windowKey, new Map());
    }

    rememberedBoundsByWindow.get(windowKey).set(String(screenId), { ...bounds });
  }

  function getRememberedBounds(windowKey, screenId) {
    const map = rememberedBoundsByWindow.get(windowKey);
    if (!map) {
      return null;
    }
    return map.get(String(screenId)) || null;
  }

  async function moveWindowsToDirection(windows, direction) {
    const screens = await backend.getScreens();
    const displayMap = mapDisplays(screens);
    const targetScreen = displayMap.resolveTargetScreen(direction);
    const targetArea = targetScreen ? getWorkArea(targetScreen) : null;

    if (!targetScreen || !targetArea) {
      throw new Error(`Unable to resolve target display for direction "${direction}".`);
    }

    const summary = {
      total: windows.length,
      moved: 0,
      failed: 0,
      failures: [],
    };

    await Promise.all(
      windows.map(async (windowRef, index) => {
        try {
          const sourceScreen = displayMap.findScreenForBounds(windowRef && windowRef.bounds) || targetScreen;
          const sourceArea = getWorkArea(sourceScreen);
          const windowKey = getWindowIdentity(windowRef, index);

          const currentRelativeBounds = clampBoundsToArea(toRelativeBounds(windowRef.bounds, sourceArea), sourceArea);
          rememberBounds(windowKey, String(sourceScreen.id), currentRelativeBounds);

          const rememberedTargetBounds = getRememberedBounds(windowKey, String(targetScreen.id));
          const targetBounds = rememberedTargetBounds
            ? clampBoundsToArea(rememberedTargetBounds, targetArea)
            : createTargetBounds(windowRef.bounds, sourceArea, targetArea);

          await backend.setWindowBounds(windowRef, {
            screenId: targetScreen.id,
            bounds: targetBounds,
          });

          rememberBounds(windowKey, String(targetScreen.id), targetBounds);
          summary.moved += 1;
        } catch (error) {
          summary.failed += 1;
          summary.failures.push({
            title: windowRef && windowRef.title ? windowRef.title : "Unknown window",
            error: String(error && error.message ? error.message : error),
          });
        }
      })
    );

    return summary;
  }

  return {
    async moveSingleWindowToDirection(windowRef, direction) {
      return moveWindowsToDirection(windowRef ? [windowRef] : [], direction);
    },
    async moveAppWindowsToDirection(selectedAppPath, selectedAppName, direction) {
      const allWindows = await backend.getWindows();
      const appWindows = allWindows.filter((windowRef) =>
        matchesApp(windowRef, selectedAppPath, selectedAppName)
      );
      return moveWindowsToDirection(appWindows, direction);
    },
  };
}

module.exports = {
  createMoveEngine,
};
