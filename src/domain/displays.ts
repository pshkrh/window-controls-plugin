export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenRef {
  id: string;
  isPrimary?: boolean;
  deviceName?: string;
  manufacturerId?: string;
  modelId?: string;
  bounds: Bounds;
  workAreaBounds?: Bounds;
}

function containsPoint(bounds: Bounds, x: number, y: number): boolean {
  return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
}

function overlapArea(a: Bounds, b: Bounds): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return width * height;
}

export function getWorkArea(screen: ScreenRef): Bounds {
  return screen.workAreaBounds || screen.bounds;
}

function pickBuiltInScreen(screens: ScreenRef[]): ScreenRef | null {
  const byName = screens.find((screen) => /built-in|retina/i.test(String(screen.deviceName || "")));
  if (byName) return byName;

  const byManufacturer = screens.find((screen) => String(screen.manufacturerId || "").toUpperCase() === "APP");
  if (byManufacturer) return byManufacturer;

  const primary = screens.find((screen) => Boolean(screen.isPrimary));
  if (primary) return primary;

  return screens[0] || null;
}

function pickExternalScreen(screens: ScreenRef[], builtInScreen: ScreenRef | null): ScreenRef | null {
  const nonBuiltIn = screens.filter((screen) => screen.id !== (builtInScreen && builtInScreen.id));
  if (!nonBuiltIn.length) return builtInScreen;

  const preferred = nonBuiltIn.find((screen) => String(screen.id) === "2");
  if (preferred) return preferred;

  return nonBuiltIn
    .slice()
    .sort((a, b) => String(a.deviceName || "").localeCompare(String(b.deviceName || "")))[0];
}

export function mapDisplays(screens: ScreenRef[]) {
  const safeScreens = Array.isArray(screens) ? screens : [];
  if (!safeScreens.length) {
    return {
      screens: [] as ScreenRef[],
      builtInScreen: null as ScreenRef | null,
      externalScreen: null as ScreenRef | null,
      badgeByScreenId: new Map<string, string>(),
      resolveTargetScreen(_direction: string) {
        return null as ScreenRef | null;
      },
      findScreenForBounds(_bounds: Bounds | null) {
        return null as ScreenRef | null;
      },
      getBadgeForScreenId(_screenId: string) {
        return "";
      },
    };
  }

  const builtInScreen = pickBuiltInScreen(safeScreens);
  const externalScreen = pickExternalScreen(safeScreens, builtInScreen);
  const badgeByScreenId = new Map<string, string>();

  if (builtInScreen) badgeByScreenId.set(String(builtInScreen.id), "1");
  if (externalScreen) badgeByScreenId.set(String(externalScreen.id), "2");

  return {
    screens: safeScreens,
    builtInScreen,
    externalScreen,
    badgeByScreenId,
    resolveTargetScreen(direction: string) {
      if (direction === "left") return builtInScreen;
      if (direction === "right") return externalScreen;
      return null;
    },
    getBadgeForScreenId(screenId: string) {
      return badgeByScreenId.get(String(screenId)) || "";
    },
    findScreenForBounds(bounds: Bounds | null) {
      if (!bounds) return null;

      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;

      for (const screen of safeScreens) {
        if (containsPoint(getWorkArea(screen), centerX, centerY)) {
          return screen;
        }
      }

      let best: ScreenRef | null = null;
      let bestArea = -1;
      for (const screen of safeScreens) {
        const area = overlapArea(bounds, getWorkArea(screen));
        if (area > bestArea) {
          bestArea = area;
          best = screen;
        }
      }

      return best;
    },
  };
}
