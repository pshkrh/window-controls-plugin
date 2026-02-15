#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { createWindowBackend, isPermissionError, openPermissionsSettings } = require("./lib/backend/system-addon");
const { mapDisplays } = require("./lib/domain/displays");
const { aggregateApps } = require("./lib/domain/apps");
const { createMoveEngine } = require("./lib/domain/move");
const { createIconRenderer } = require("./lib/render/icons");
const { MODE_LIST, MODE_DIRECTION, createStateStore } = require("./lib/runtime/state");
const { createStreamDeckClient } = require("./lib/runtime/streamdeck-client");

const ACTION_UUID = "com.pshkrh.window-controls.key";
const DEFAULT_PAGE_SIZE = 12;
const AUTO_REFRESH_MS = 2000;
const APPEAR_KEYDOWN_SUPPRESS_MS = 220;
const OPEN_KEY_SUPPRESS_MS = 1200;
const APPEAR_CYCLE_GAP_MS = 120;
const STALE_CONTEXT_MAX_AGE_MS = 250;
const EXPECTED_PLUGIN_KEY_CONTEXTS = 14;

const ROLE_APP_SLOT = "app_slot";
const ROLE_REFRESH = "refresh";
const ROLE_PAGE_PREV = "page_prev";
const ROLE_PAGE_NEXT = "page_next";
const ROLE_MOVE_LEFT = "move_left";
const ROLE_MOVE_RIGHT = "move_right";
const ROLE_MODE_BACK = "mode_back";
const ICON_CACHE_DIR = path.join(__dirname, "..", "imgs", "runtime-cache");

const DEFAULT_ROLE_BY_COORDINATE = new Map([
  ["0,1", { role: ROLE_PAGE_PREV }],
  ["0,2", { role: ROLE_PAGE_NEXT }],
  ["1,0", { role: ROLE_APP_SLOT, slotIndex: 0 }],
  ["2,0", { role: ROLE_APP_SLOT, slotIndex: 1 }],
  ["3,0", { role: ROLE_APP_SLOT, slotIndex: 2 }],
  ["4,0", { role: ROLE_APP_SLOT, slotIndex: 3 }],
  ["1,1", { role: ROLE_APP_SLOT, slotIndex: 4 }],
  ["2,1", { role: ROLE_APP_SLOT, slotIndex: 5 }],
  ["3,1", { role: ROLE_APP_SLOT, slotIndex: 6 }],
  ["4,1", { role: ROLE_APP_SLOT, slotIndex: 7 }],
  ["1,2", { role: ROLE_APP_SLOT, slotIndex: 8 }],
  ["2,2", { role: ROLE_APP_SLOT, slotIndex: 9 }],
  ["3,2", { role: ROLE_APP_SLOT, slotIndex: 10 }],
  ["4,2", { role: ROLE_APP_SLOT, slotIndex: 11 }],
]);

const DIRECTION_WINDOW_SLOT_BY_COORD = new Map([
  ["1,0", 0],
  ["2,0", 1],
  ["3,0", 2],
  ["1,1", 3],
  ["2,1", 4],
  ["3,1", 5],
  ["1,2", 6],
  ["2,2", 7],
  ["3,2", 8],
]);
const DIRECTION_PAGE_SIZE = DIRECTION_WINDOW_SLOT_BY_COORD.size;
const LIST_APP_SLOT_BY_COORD = new Map([
  ["1,0", 0],
  ["2,0", 1],
  ["3,0", 2],
  ["4,0", 3],
  ["1,1", 4],
  ["2,1", 5],
  ["3,1", 6],
  ["4,1", 7],
  ["1,2", 8],
  ["2,2", 9],
  ["3,2", 10],
  ["4,2", 11],
]);
const LIST_PAGE_SIZE = LIST_APP_SLOT_BY_COORD.size;

const store = createStateStore();
const contexts = new Map();
const renderCache = new Map();

const client = createStreamDeckClient();
const backend = createWindowBackend(__dirname);
const moveEngine = createMoveEngine(backend);

const iconRenderer = createIconRenderer({
  cacheDirectory: ICON_CACHE_DIR,
  rendererScriptPath: path.join(__dirname, "scripts", "render_badged_icon.py"),
  pluginRootDirectory: path.resolve(__dirname, ".."),
});
const IDLE_IMAGE = iconRenderer.getControlIconDataUrl("idle", " ");

let displayMap = mapDisplays([]);
let permissionBlocked = false;
let prewarmScheduled = false;
let refreshInProgress = false;
let lastAppearAt = 0;

function coordinateKey(coordinates) {
  if (!coordinates) {
    return "";
  }
  return `${coordinates.column},${coordinates.row}`;
}

function hasStableContextLayout() {
  return contexts.size >= EXPECTED_PLUGIN_KEY_CONTEXTS;
}

function getEffectiveRole(mode, coordinates) {
  const coord = coordinateKey(coordinates);
  if (!coord) {
    return null;
  }

  if (mode === MODE_DIRECTION) {
    if (coord === "4,0") {
      return ROLE_MODE_BACK;
    }
    if (coord === "4,1") {
      return ROLE_MOVE_LEFT;
    }
    if (coord === "4,2") {
      return ROLE_MOVE_RIGHT;
    }
    if (coord === "0,1") {
      return ROLE_REFRESH;
    }
    if (DIRECTION_WINDOW_SLOT_BY_COORD.has(coord)) {
      return ROLE_APP_SLOT;
    }
    return null;
  }

  if (coord === "0,1") {
    return ROLE_PAGE_PREV;
  }
  if (coord === "0,2") {
    return ROLE_PAGE_NEXT;
  }
  if (LIST_APP_SLOT_BY_COORD.has(coord)) {
    return ROLE_APP_SLOT;
  }

  return null;
}

function getDefaultSettingsFromCoordinates(coordinates) {
  const key = coordinateKey(coordinates);
  const found = DEFAULT_ROLE_BY_COORDINATE.get(key);

  if (found) {
    return {
      role: found.role,
      slotIndex: Number.isInteger(found.slotIndex) ? found.slotIndex : null,
      pageSize: DEFAULT_PAGE_SIZE,
    };
  }

  return {
    role: ROLE_APP_SLOT,
    slotIndex: null,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

function normalizeSettings(settings, coordinates) {
  const defaults = getDefaultSettingsFromCoordinates(coordinates);

  // Keep role/slot fixed by key coordinates to avoid stale persisted settings corrupting the layout.
  const role = defaults.role || (settings && settings.role) || ROLE_APP_SLOT;
  const normalized = {
    role,
    slotIndex: Number.isInteger(defaults.slotIndex)
      ? defaults.slotIndex
      : Number.isInteger(settings && settings.slotIndex)
      ? settings.slotIndex
      : null,
    homeProfileUUID:
      settings && typeof settings.homeProfileUUID === "string" && settings.homeProfileUUID
        ? settings.homeProfileUUID
        : "",
    homeProfileName:
      settings && typeof settings.homeProfileName === "string" && settings.homeProfileName
        ? settings.homeProfileName
        : "",
    pageSize:
      settings && Number.isInteger(settings.pageSize) && settings.pageSize > 0
        ? settings.pageSize
        : DEFAULT_PAGE_SIZE,
  };

  return normalized;
}

function formatText(text, maxLength) {
  const value = text || "";
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatAppTitle(app) {
  return formatText((app && app.appName) || "App", 12);
}

function formatWindowTitle(windowEntry) {
  return formatText((windowEntry && windowEntry.title) || "Window", 12);
}

function getListPageSize() {
  return LIST_PAGE_SIZE;
}

function getListTotalPages(state, pageSize) {
  return Math.max(1, Math.ceil(state.apps.length / pageSize));
}

function ensureListPageInBounds() {
  const state = store.getState();
  const pageSize = getListPageSize();
  const maxPage = getListTotalPages(state, pageSize) - 1;
  if (state.currentPage > maxPage) {
    store.setPage(maxPage);
  }
}

function appForListSlot(coordinates) {
  const coord = coordinateKey(coordinates);
  const slotIndex = LIST_APP_SLOT_BY_COORD.get(coord);
  if (!Number.isInteger(slotIndex)) {
    return null;
  }

  const state = store.getState();
  const pageSize = getListPageSize();
  const index = state.currentPage * pageSize + slotIndex;
  return state.apps[index] || null;
}

function getSelectedApp() {
  const state = store.getState();

  return (
    state.apps.find((app) => {
      if (state.selectedAppPath) {
        return app.appPath === state.selectedAppPath;
      }
      return app.appName === state.selectedAppName;
    }) || null
  );
}

function getWindowIdentity(windowRef, index) {
  const explicitId =
    windowRef &&
    (windowRef.id ?? windowRef.windowId ?? windowRef.kCGWindowNumber ?? windowRef.cgWindowID ?? windowRef.number);

  if (explicitId !== undefined && explicitId !== null) {
    return `id:${String(explicitId)}`;
  }

  const appPath = (windowRef && windowRef.application && windowRef.application.path) || "";
  const title = (windowRef && windowRef.title) || "";
  return `fallback:${appPath}|${title}|${index}`;
}

function describeSelectedAppWindows() {
  const selectedApp = getSelectedApp();
  if (!selectedApp || !Array.isArray(selectedApp.windows)) {
    return [];
  }

  const sortedWindows = selectedApp.windows.slice().sort((a, b) => {
    const titleA = (a && a.title) || "";
    const titleB = (b && b.title) || "";
    const byTitle = titleA.localeCompare(titleB, undefined, { sensitivity: "base" });
    if (byTitle !== 0) {
      return byTitle;
    }

    const ax = (a && a.bounds && a.bounds.x) || 0;
    const bx = (b && b.bounds && b.bounds.x) || 0;
    if (ax !== bx) {
      return ax - bx;
    }

    const ay = (a && a.bounds && a.bounds.y) || 0;
    const by = (b && b.bounds && b.bounds.y) || 0;
    return ay - by;
  });

  return sortedWindows.map((windowRef, index) => {
    const screen = displayMap.findScreenForBounds((windowRef && windowRef.bounds) || null);
    const badge = screen ? displayMap.getBadgeForScreenId(screen.id) : "";

    return {
      key: getWindowIdentity(windowRef, index),
      title: (windowRef && windowRef.title) || `${selectedApp.appName || "Window"} ${index + 1}`,
      appPath: selectedApp.appPath,
      appName: selectedApp.appName || "",
      displayBadge: badge,
      windowRef,
    };
  });
}

function getDirectionTotalPages(windowCount) {
  return Math.max(1, Math.ceil(windowCount / DIRECTION_PAGE_SIZE));
}

function ensureDirectionPageInBounds(windowCount) {
  const state = store.getState();
  const maxPage = getDirectionTotalPages(windowCount) - 1;
  if (state.directionPage > maxPage) {
    store.setDirectionPage(maxPage);
  }
}

function getDirectionSlotPosition(coordinates) {
  const key = coordinateKey(coordinates);
  const slot = DIRECTION_WINDOW_SLOT_BY_COORD.get(key);
  if (!Number.isInteger(slot)) {
    return null;
  }
  return slot;
}

function getSelectedWindowEntry() {
  const state = store.getState();
  const windows = describeSelectedAppWindows();
  if (!windows.length) {
    return null;
  }

  if (state.selectedWindowKey) {
    const match = windows.find((entry) => entry.key === state.selectedWindowKey);
    if (match) {
      return match;
    }
  }

  return windows[0] || null;
}

function windowForDirectionSlot(coordinates) {
  const slotPosition = getDirectionSlotPosition(coordinates);
  if (!Number.isInteger(slotPosition)) {
    return null;
  }

  const state = store.getState();
  const windows = describeSelectedAppWindows();
  const index = state.directionPage * DIRECTION_PAGE_SIZE + slotPosition;
  return windows[index] || null;
}

function setVisual(context, imageDataUrl, title) {
  const nextKey = `${imageDataUrl || ""}|${title || ""}`;
  const previousKey = renderCache.get(context);
  if (previousKey === nextKey) {
    return;
  }

  renderCache.set(context, nextKey);
  client.setImage(context, imageDataUrl || iconRenderer.transparentImage);
  client.setTitle(context, title || "");
}

function clearVisual(context) {
  setVisual(context, IDLE_IMAGE, "");
}

function setControlVisual(context, role, label = "") {
  setVisual(context, iconRenderer.getControlIconDataUrl(role, label), "");
}

function setPagedControlVisual(context, role, hasMultiplePages) {
  if (hasMultiplePages) {
    setControlVisual(context, role);
  } else {
    clearVisual(context);
  }
}

function refreshVisibleState() {
  ensureVisibleIconsReadySync();
  renderAllContexts();
  scheduleIconPrewarm();
}

function renderPermissionState(contextState) {
  const { context, settings, coordinates } = contextState;
  const mode = store.getState().mode;
  const effectiveRole = getEffectiveRole(mode, coordinates);

  if (effectiveRole === ROLE_MODE_BACK) {
    setVisual(context, iconRenderer.getControlIconDataUrl("permission", "LOCK"), "Grant\nAccess");
    return;
  }

  if (effectiveRole === ROLE_PAGE_PREV) {
    setControlVisual(context, ROLE_PAGE_PREV, "<");
    return;
  }

  if (effectiveRole === ROLE_PAGE_NEXT) {
    setControlVisual(context, ROLE_PAGE_NEXT, ">");
    return;
  }

  if (effectiveRole === ROLE_MOVE_LEFT) {
    setControlVisual(context, ROLE_MOVE_LEFT, "<");
    return;
  }

  if (effectiveRole === ROLE_MOVE_RIGHT) {
    setControlVisual(context, ROLE_MOVE_RIGHT, ">");
    return;
  }

  if (effectiveRole === ROLE_APP_SLOT && settings.slotIndex === 0) {
    setVisual(context, iconRenderer.getControlIconDataUrl("permission", "LOCK"), "Grant\nScreen\nAccess");
    return;
  }

  clearVisual(context);
}

function renderListMode(contextState) {
  const { context, coordinates } = contextState;
  const state = store.getState();
  const listTotalPages = getListTotalPages(state, getListPageSize());
  const effectiveRole = getEffectiveRole(MODE_LIST, coordinates);

  if (effectiveRole === ROLE_PAGE_PREV) {
    setPagedControlVisual(context, ROLE_PAGE_PREV, listTotalPages > 1);
    return;
  }

  if (effectiveRole === ROLE_PAGE_NEXT) {
    setPagedControlVisual(context, ROLE_PAGE_NEXT, listTotalPages > 1);
    return;
  }

  if (effectiveRole !== ROLE_APP_SLOT) {
    clearVisual(context);
    return;
  }

  if (!hasStableContextLayout()) {
    clearVisual(context);
    return;
  }

  const app = appForListSlot(coordinates);
  if (!app) {
    clearVisual(context);
    return;
  }

  const image = iconRenderer.getAppIconDataUrl(app.appPath, app.displayBadge, false, true, app.appName || "") || IDLE_IMAGE;
  setVisual(context, image, formatAppTitle(app));
}

function renderDirectionMode(contextState) {
  const { context, coordinates } = contextState;
  const state = store.getState();
  const effectiveRole = getEffectiveRole(MODE_DIRECTION, coordinates);
  const selectedApp = getSelectedApp();
  const windows = selectedApp ? describeSelectedAppWindows() : [];
  const totalPages = getDirectionTotalPages(windows.length);
  const selectedWindow =
    selectedApp && windows.length
      ? windows.find((entry) => entry.key === state.selectedWindowKey) || windows[0]
      : null;

  if (effectiveRole === ROLE_MODE_BACK) {
    setControlVisual(context, ROLE_MODE_BACK);
    return;
  }

  if (effectiveRole === ROLE_MOVE_LEFT) {
    setControlVisual(context, ROLE_MOVE_LEFT);
    return;
  }

  if (effectiveRole === ROLE_MOVE_RIGHT) {
    setControlVisual(context, ROLE_MOVE_RIGHT);
    return;
  }

  if (effectiveRole === ROLE_REFRESH) {
    setPagedControlVisual(context, ROLE_REFRESH, totalPages > 1);
    return;
  }

  if (effectiveRole === ROLE_APP_SLOT) {
    if (!hasStableContextLayout()) {
      clearVisual(context);
      return;
    }

    const slotPosition = getDirectionSlotPosition(coordinates);
    if (!Number.isInteger(slotPosition)) {
      clearVisual(context);
      return;
    }

    const index = state.directionPage * DIRECTION_PAGE_SIZE + slotPosition;
    const windowEntry = windows[index] || null;
    if (!windowEntry) {
      clearVisual(context);
      return;
    }

    const isSelected = selectedWindow && selectedWindow.key === windowEntry.key;
    const image =
      iconRenderer.getAppIconDataUrl(
        windowEntry.appPath,
        windowEntry.displayBadge,
        Boolean(isSelected),
        true,
        windowEntry.appName || ""
      ) ||
      IDLE_IMAGE;
    setVisual(context, image, formatWindowTitle(windowEntry));
    return;
  }

  clearVisual(context);
}

function renderAllContexts() {
  const state = store.getState();
  for (const contextState of contexts.values()) {
    if (permissionBlocked) {
      renderPermissionState(contextState);
      continue;
    }

    if (state.mode === MODE_LIST) {
      renderListMode(contextState);
    } else {
      renderDirectionMode(contextState);
    }
  }
}

function collectVisibleAppVariants() {
  const state = store.getState();
  const appVariants = new Map();
  const directionWindows = state.mode === MODE_DIRECTION ? describeSelectedAppWindows() : [];
  const selectedWindow =
    state.mode === MODE_DIRECTION
      ? directionWindows.find((entry) => entry.key === state.selectedWindowKey) || directionWindows[0] || null
      : null;

  for (const contextState of contexts.values()) {
    if (permissionBlocked) {
      continue;
    }

    if (state.mode === MODE_LIST) {
      if (!LIST_APP_SLOT_BY_COORD.has(coordinateKey(contextState.coordinates))) {
        continue;
      }

      const app = appForListSlot(contextState.coordinates);
      if (!app) {
        continue;
      }

      const key = `${app.appPath}|${app.appName || ""}|${app.displayBadge || ""}|0`;
      if (!appVariants.has(key)) {
        appVariants.set(key, {
          appPath: app.appPath,
          appName: app.appName || "",
          badge: app.displayBadge || "",
          selected: false,
        });
      }
      continue;
    }

    if (state.mode === MODE_DIRECTION) {
      if (getEffectiveRole(MODE_DIRECTION, contextState.coordinates) !== ROLE_APP_SLOT) {
        continue;
      }

      const slotPosition = getDirectionSlotPosition(contextState.coordinates);
      if (!Number.isInteger(slotPosition)) {
        continue;
      }

      const windowIndex = state.directionPage * DIRECTION_PAGE_SIZE + slotPosition;
      const windowEntry = directionWindows[windowIndex] || null;
      if (!windowEntry) {
        continue;
      }

      const selected = Boolean(selectedWindow && selectedWindow.key === windowEntry.key);
      const key = `${windowEntry.appPath}|${windowEntry.appName || ""}|${windowEntry.displayBadge || ""}|${selected ? "1" : "0"}`;
      if (!appVariants.has(key)) {
        appVariants.set(key, {
          appPath: windowEntry.appPath,
          appName: windowEntry.appName || "",
          badge: windowEntry.displayBadge || "",
          selected,
        });
      }
    }
  }

  return appVariants.values();
}

function ensureVisibleIconsReadySync() {
  if (!hasStableContextLayout()) {
    return;
  }

  for (const variant of collectVisibleAppVariants()) {
    iconRenderer.getAppIconDataUrl(variant.appPath, variant.badge, variant.selected, true, variant.appName || "");
  }
}

function prewarmVisibleIcons() {
  for (const variant of collectVisibleAppVariants()) {
    iconRenderer.prewarmAppIcon(variant.appPath, variant.badge, variant.selected, variant.appName || "");
  }
}

function scheduleIconPrewarm(delayMs = 0) {
  if (prewarmScheduled) {
    return;
  }

  prewarmScheduled = true;
  setTimeout(() => {
    prewarmScheduled = false;
    try {
      prewarmVisibleIcons();
      renderAllContexts();
      if (iconRenderer.hasPendingAppIcons()) {
        scheduleIconPrewarm(120);
      }
    } catch (error) {
      client.logMessage(`Icon prewarm failed: ${String(error && error.message ? error.message : error)}`);
    }
  }, delayMs);
}

async function refreshInventory(reason) {
  if (refreshInProgress) {
    return;
  }

  refreshInProgress = true;
  try {
    const screens = await backend.getScreens();
    displayMap = mapDisplays(screens);

    const windows = await backend.getWindows();
    const apps = aggregateApps(windows, displayMap);

    store.setApps(apps);
    ensureListPageInBounds();

    const state = store.getState();
    const selectedApp = getSelectedApp();
    if (state.mode === MODE_DIRECTION && !selectedApp) {
      store.clearSelection();
    }

    if (store.getState().mode === MODE_DIRECTION) {
      const selectedWindows = describeSelectedAppWindows();
      ensureDirectionPageInBounds(selectedWindows.length);

      const nextState = store.getState();
      const hasSelectedWindow = selectedWindows.some((entry) => entry.key === nextState.selectedWindowKey);
      if (!hasSelectedWindow) {
        if (selectedWindows[0]) {
          store.selectWindow(selectedWindows[0].key);
        } else {
          store.selectWindow("");
        }
      }
    }

    permissionBlocked = false;
    refreshVisibleState();
  } catch (error) {
    client.logMessage(`Refresh failed (${reason}): ${String(error && error.message ? error.message : error)}`);

    if (isPermissionError(error)) {
      permissionBlocked = true;
      renderAllContexts();
      return;
    }

    throw error;
  } finally {
    refreshInProgress = false;
  }
}

function listPageOffset(delta) {
  const state = store.getState();
  const pageSize = getListPageSize();
  const totalPages = getListTotalPages(state, pageSize);
  const nextPage = Math.max(0, Math.min(totalPages - 1, state.currentPage + delta));
  if (nextPage !== state.currentPage) {
    store.setPage(nextPage);
  }
  refreshVisibleState();
}

function directionPageOffset(delta, options = {}) {
  const wrap = Boolean(options && options.wrap);
  const state = store.getState();
  const windows = describeSelectedAppWindows();
  const totalPages = getDirectionTotalPages(windows.length);
  let nextPage = state.directionPage + delta;
  if (wrap && totalPages > 0) {
    if (nextPage < 0) {
      nextPage = totalPages - 1;
    } else if (nextPage > totalPages - 1) {
      nextPage = 0;
    }
  }
  nextPage = Math.max(0, Math.min(totalPages - 1, nextPage));
  if (nextPage !== state.directionPage) {
    store.setDirectionPage(nextPage);
  }
  refreshVisibleState();
}

function selectAppFromSlot(coordinates) {
  const app = appForListSlot(coordinates);
  if (!app) {
    return;
  }

  store.selectApp(app);
  store.setLastMoveSummary(null);

  const windows = describeSelectedAppWindows();
  if (windows[0]) {
    store.selectWindow(windows[0].key);
  } else {
    store.selectWindow("");
  }
  refreshVisibleState();
}

function selectDirectionWindowFromSlot(coordinates) {
  const windowEntry = windowForDirectionSlot(coordinates);
  if (!windowEntry) {
    return;
  }

  store.selectWindow(windowEntry.key);
  refreshVisibleState();
}

async function handleMove(direction, context) {
  const selectedWindow = getSelectedWindowEntry();
  if (!selectedWindow || !selectedWindow.windowRef) {
    renderAllContexts();
    return;
  }

  try {
    const summary = await moveEngine.moveSingleWindowToDirection(selectedWindow.windowRef, direction);

    store.setLastMoveSummary(summary);
    renderAllContexts();

    if (summary.failed > 0) {
      client.showAlert(context);
    }

    refreshInventory(`move:${direction}`).catch((error) => {
      client.logMessage(`Post-move refresh failed: ${String(error && error.message ? error.message : error)}`);
    });
  } catch (error) {
    if (isPermissionError(error)) {
      permissionBlocked = true;
      client.showAlert(context);
      openPermissionsSettings();
      renderAllContexts();
      return;
    }

    client.showAlert(context);
    client.logMessage(`Move failed: ${String(error && error.message ? error.message : error)}`);
  }
}

async function handleKeyDown(event) {
  const contextState = contexts.get(event.context);
  if (!contextState) {
    return;
  }

  if (contextState.suppressKeyDownUntil && Date.now() < contextState.suppressKeyDownUntil) {
    return;
  }

  const { settings, coordinates } = contextState;
  const state = store.getState();
  const effectiveRole = getEffectiveRole(state.mode, coordinates);

  const navigateHomeFromList = () => {
    const homeProfileUUID = settings.homeProfileUUID || "";
    const homeProfileName = settings.homeProfileName || "";
    const targetDevice = contextState.device || event.device || "";

    if (!targetDevice) {
      client.showAlert(event.context);
      return;
    }

    // Return to previous profile/page (matches native folder back behavior).
    client.switchToProfile(event.context, targetDevice);

    if (homeProfileUUID) {
      setTimeout(() => {
        client.switchToProfile(event.context, targetDevice, homeProfileUUID);
      }, 120);
    }

    if (homeProfileName && homeProfileName !== homeProfileUUID) {
      setTimeout(() => {
        client.switchToProfile(event.context, targetDevice, homeProfileName);
      }, 220);
    }
  };

  if (permissionBlocked) {
    if (effectiveRole === ROLE_MODE_BACK) {
      if (state.mode === MODE_LIST) {
        navigateHomeFromList();
      } else {
        store.clearSelection();
        refreshVisibleState();
      }
      return;
    }
    openPermissionsSettings();
    await refreshInventory("permission-refresh");
    return;
  }

  if (state.mode === MODE_LIST) {
    if (effectiveRole === ROLE_MODE_BACK) {
      navigateHomeFromList();
      return;
    }

    if (effectiveRole === ROLE_PAGE_PREV) {
      listPageOffset(-1);
      return;
    }

    if (effectiveRole === ROLE_PAGE_NEXT) {
      listPageOffset(1);
      return;
    }

    if (effectiveRole === ROLE_APP_SLOT && appForListSlot(coordinates)) {
      selectAppFromSlot(coordinates);
      return;
    }

    return;
  }

  if (state.mode === MODE_DIRECTION) {
    if (effectiveRole === ROLE_MODE_BACK) {
      store.clearSelection();
      refreshVisibleState();
      return;
    }

    if (effectiveRole === ROLE_MOVE_LEFT) {
      await handleMove("left", event.context);
      return;
    }

    if (effectiveRole === ROLE_MOVE_RIGHT) {
      await handleMove("right", event.context);
      return;
    }

    if (effectiveRole === ROLE_REFRESH) {
      directionPageOffset(1, { wrap: true });
      return;
    }

    if (effectiveRole === ROLE_APP_SLOT) {
      selectDirectionWindowFromSlot(coordinates);
      return;
    }
  }
}

function upsertContext(event) {
  const coordinates = event.payload && event.payload.coordinates ? event.payload.coordinates : null;
  const settings = normalizeSettings(event.payload && event.payload.settings, coordinates);
  const now = Date.now();
  const suppressMs =
    coordinates && coordinates.column === 4 && coordinates.row === 0 ? OPEN_KEY_SUPPRESS_MS : APPEAR_KEYDOWN_SUPPRESS_MS;

  contexts.set(event.context, {
    context: event.context,
    action: event.action,
    device: event.device || "",
    coordinates,
    settings,
    appearedAt: now,
    suppressKeyDownUntil: now + suppressMs,
  });

  client.setSettings(event.context, settings);
}

function removeContext(context) {
  const wasDirectionMode = store.getState().mode === MODE_DIRECTION;

  contexts.delete(context);
  renderCache.delete(context);

  if (wasDirectionMode) {
    store.clearSelection();
  }
}

function handleDidReceiveSettings(event) {
  const current = contexts.get(event.context);
  const coordinates = current && current.coordinates ? current.coordinates : null;
  const settings = normalizeSettings(event.payload && event.payload.settings, coordinates);

  contexts.set(event.context, {
    context: event.context,
    action: event.action,
    device: (current && current.device) || event.device || "",
    coordinates,
    settings,
    appearedAt: (current && current.appearedAt) || Date.now(),
    suppressKeyDownUntil: (current && current.suppressKeyDownUntil) || 0,
  });

  client.setSettings(event.context, settings);
  refreshVisibleState();
}

function handleIncomingEvent(event) {
  if (event.action !== ACTION_UUID) {
    return;
  }

  if (event.event === "willAppear") {
    const now = Date.now();

    const shouldResetStaleContexts =
      contexts.size > 0 &&
      !contexts.has(event.context) &&
      Array.from(contexts.values()).every((contextState) => now - contextState.appearedAt > STALE_CONTEXT_MAX_AGE_MS);

    if (shouldResetStaleContexts) {
      contexts.clear();
      renderCache.clear();
      store.clearSelection();
    }

    if (now - lastAppearAt > APPEAR_CYCLE_GAP_MS) {
      contexts.clear();
      renderCache.clear();
      store.clearSelection();
    }
    lastAppearAt = now;

    if (contexts.size === 0) {
      store.clearSelection();
    }
    upsertContext(event);
    clearVisual(event.context);
    refreshVisibleState();
    return;
  }

  if (event.event === "willDisappear") {
    removeContext(event.context);
    return;
  }

  if (event.event === "didReceiveSettings") {
    handleDidReceiveSettings(event);
    return;
  }

  if (event.event === "keyDown") {
    handleKeyDown(event).catch((error) => {
      client.logMessage(`keyDown handler failed: ${String(error && error.message ? error.message : error)}`);
    });
  }
}

function ensureCacheDirectory() {
  if (!fs.existsSync(ICON_CACHE_DIR)) {
    fs.mkdirSync(ICON_CACHE_DIR, { recursive: true });
  }
}

function start() {
  ensureCacheDirectory();
  client.onEvent(handleIncomingEvent);
  client.connect();

  refreshInventory("startup").catch((error) => {
    client.logMessage(`Initial refresh failed: ${String(error && error.message ? error.message : error)}`);
  });

  setInterval(() => {
    refreshInventory("auto-refresh").catch((error) => {
      client.logMessage(`Auto refresh failed: ${String(error && error.message ? error.message : error)}`);
    });
  }, AUTO_REFRESH_MS);
}

start();
