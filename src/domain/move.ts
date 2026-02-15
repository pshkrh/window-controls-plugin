import { getWorkArea, mapDisplays } from "./displays";
import { extractAppName, extractDirectAppPath } from "./app-utils";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizedRelativePosition(bounds: any, sourceArea: any) {
  const relativeX = sourceArea.width > 0 ? (bounds.x - sourceArea.x) / sourceArea.width : 0;
  const relativeY = sourceArea.height > 0 ? (bounds.y - sourceArea.y) / sourceArea.height : 0;

  return {
    x: clamp(relativeX, 0, 1),
    y: clamp(relativeY, 0, 1),
  };
}

function normalizedRelativeSize(bounds: any, sourceArea: any) {
  const relativeWidth = sourceArea.width > 0 ? bounds.width / sourceArea.width : 0;
  const relativeHeight = sourceArea.height > 0 ? bounds.height / sourceArea.height : 0;

  return {
    width: clamp(relativeWidth, 0.05, 1),
    height: clamp(relativeHeight, 0.05, 1),
  };
}

function toRelativeBounds(bounds: any, area: any) {
  return {
    x: safeNumber(bounds.x, area.x) - area.x,
    y: safeNumber(bounds.y, area.y) - area.y,
    width: safeNumber(bounds.width, 800),
    height: safeNumber(bounds.height, 600),
  };
}

function clampBoundsToArea(bounds: any, targetArea: any) {
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

function createTargetBounds(bounds: any, sourceArea: any, targetArea: any) {
  const relative = normalizedRelativePosition(bounds, sourceArea);
  const relativeSize = normalizedRelativeSize(bounds, sourceArea);

  let width = safeNumber(bounds.width, 800);
  let height = safeNumber(bounds.height, 600);

  // Keep absolute size when it fits. If not, scale proportionally to preserve visual coverage.
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

  return { x, y, width: Math.round(width), height: Math.round(height) };
}

function matchesApp(windowRef: any, selectedAppPath: string, selectedAppName: string) {
  const app = windowRef?.application || {};
  const appPath = extractDirectAppPath(app);
  const appName = extractAppName(app, "", "");

  if (selectedAppPath && appPath === selectedAppPath) {
    return true;
  }

  if (selectedAppName && appName === selectedAppName) {
    return true;
  }

  return false;
}

export function createMoveEngine(backend: any) {
  const rememberedBoundsByWindow = new Map<string, Map<string, any>>();

  function getWindowIdentity(windowRef: any, index: number): string {
    const explicitId =
      windowRef?.id ??
      windowRef?.windowId ??
      windowRef?.kCGWindowNumber ??
      windowRef?.cgWindowID ??
      windowRef?.number;
    if (explicitId !== undefined && explicitId !== null) {
      return `id:${String(explicitId)}`;
    }

    const appPath = extractDirectAppPath(windowRef?.application || {});
    const title = windowRef?.title || "";
    return `fallback:${appPath}|${title}|${index}`;
  }

  function rememberBounds(windowKey: string, screenId: string, bounds: any): void {
    if (!windowKey || !screenId || !bounds) {
      return;
    }

    if (!rememberedBoundsByWindow.has(windowKey)) {
      rememberedBoundsByWindow.set(windowKey, new Map());
    }

    rememberedBoundsByWindow.get(windowKey)!.set(String(screenId), { ...bounds });
  }

  function getRememberedBounds(windowKey: string, screenId: string): any {
    const map = rememberedBoundsByWindow.get(windowKey);
    if (!map) {
      return null;
    }
    return map.get(String(screenId)) || null;
  }

  async function moveWindowsToDirection(windows: any[], direction: "left" | "right") {
    const screens = await backend.getScreens();
    const displayMap = mapDisplays(screens);
    const targetScreen = displayMap.resolveTargetScreen(direction);
    const targetArea = targetScreen ? getWorkArea(targetScreen) : null;

    if (!targetScreen || !targetArea) {
      throw new Error(`Unable to resolve target display for direction \"${direction}\".`);
    }

    const summary = {
      total: windows.length,
      moved: 0,
      failed: 0,
      failures: [] as Array<{ title: string; error: string }>,
    };

    await Promise.all(
      windows.map(async (windowRef: any, index: number) => {
        try {
          const sourceScreen = displayMap.findScreenForBounds(windowRef?.bounds) || targetScreen;
          const sourceArea = getWorkArea(sourceScreen);
          const windowKey = getWindowIdentity(windowRef, index);

          // Store current bounds relative to the source screen for round-trip restoration.
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
        } catch (error: any) {
          summary.failed += 1;
          summary.failures.push({
            title: windowRef?.title || "Unknown window",
            error: String(error?.message || error),
          });
        }
      })
    );

    return summary;
  }

  return {
    async moveSingleWindowToDirection(windowRef: any, direction: "left" | "right") {
      return moveWindowsToDirection(windowRef ? [windowRef] : [], direction);
    },
    async moveAppWindowsToDirection(selectedAppPath: string, selectedAppName: string, direction: "left" | "right") {
      const allWindows = await backend.getWindows();
      const appWindows = allWindows.filter((windowRef: any) =>
        matchesApp(windowRef, selectedAppPath, selectedAppName)
      );
      return moveWindowsToDirection(appWindows, direction);
    },
  };
}
