"use strict";

function containsPoint(bounds, x, y) {
  return (
    x >= bounds.x &&
    x < bounds.x + bounds.width &&
    y >= bounds.y &&
    y < bounds.y + bounds.height
  );
}

function overlapArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return width * height;
}

function getWorkArea(screen) {
  return screen.workAreaBounds || screen.bounds;
}

function pickBuiltInScreen(screens) {
  const byName = screens.find((screen) => /built-in|retina/i.test(String(screen.deviceName || "")));
  if (byName) {
    return byName;
  }

  const byManufacturer = screens.find((screen) => String(screen.manufacturerId || "").toUpperCase() === "APP");
  if (byManufacturer) {
    return byManufacturer;
  }

  const primary = screens.find((screen) => Boolean(screen.isPrimary));
  if (primary) {
    return primary;
  }

  return screens[0] || null;
}

function pickExternalScreen(screens, builtInScreen) {
  const nonBuiltIn = screens.filter((screen) => screen.id !== (builtInScreen && builtInScreen.id));
  if (!nonBuiltIn.length) {
    return builtInScreen;
  }

  const preferredById = nonBuiltIn.find((screen) => String(screen.id) === "2");
  if (preferredById) {
    return preferredById;
  }

  const sorted = nonBuiltIn.slice().sort((a, b) => String(a.deviceName || "").localeCompare(String(b.deviceName || "")));
  return sorted[0];
}

function mapDisplays(screens) {
  const safeScreens = Array.isArray(screens) ? screens : [];
  if (!safeScreens.length) {
    return {
      screens: [],
      builtInScreen: null,
      externalScreen: null,
      badgeByScreenId: new Map(),
      resolveTargetScreen(direction) {
        return null;
      },
      findScreenForBounds(bounds) {
        return null;
      },
      getBadgeForScreenId() {
        return "";
      },
    };
  }

  const builtInScreen = pickBuiltInScreen(safeScreens);
  const externalScreen = pickExternalScreen(safeScreens, builtInScreen);
  const badgeByScreenId = new Map();

  if (builtInScreen) {
    badgeByScreenId.set(String(builtInScreen.id), "1");
  }

  if (externalScreen) {
    badgeByScreenId.set(String(externalScreen.id), "2");
  }

  return {
    screens: safeScreens,
    builtInScreen,
    externalScreen,
    badgeByScreenId,
    resolveTargetScreen(direction) {
      if (direction === "left") {
        return builtInScreen;
      }
      if (direction === "right") {
        return externalScreen;
      }
      return null;
    },
    getBadgeForScreenId(screenId) {
      return badgeByScreenId.get(String(screenId)) || "";
    },
    findScreenForBounds(bounds) {
      if (!bounds || typeof bounds.x !== "number" || typeof bounds.y !== "number") {
        return null;
      }

      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;

      let containsMatch = null;
      for (const screen of safeScreens) {
        const workArea = getWorkArea(screen);
        if (containsPoint(workArea, centerX, centerY)) {
          containsMatch = screen;
          break;
        }
      }

      if (containsMatch) {
        return containsMatch;
      }

      let bestScreen = null;
      let bestArea = -1;
      for (const screen of safeScreens) {
        const area = overlapArea(bounds, getWorkArea(screen));
        if (area > bestArea) {
          bestArea = area;
          bestScreen = screen;
        }
      }

      return bestScreen;
    },
  };
}

module.exports = {
  mapDisplays,
  getWorkArea,
};
