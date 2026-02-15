"use strict";

const MODE_LIST = "list";
const MODE_DIRECTION = "direction";

function createInitialState() {
  return {
    mode: MODE_LIST,
    currentPage: 0,
    directionPage: 0,
    selectedAppPath: "",
    selectedAppName: "",
    selectedWindowKey: "",
    apps: [],
    lastRefreshAt: 0,
    lastMoveSummary: null,
  };
}

function createStateStore() {
  let state = createInitialState();

  return {
    getState() {
      return state;
    },
    update(partialState) {
      state = {
        ...state,
        ...partialState,
      };
      return state;
    },
    setApps(apps) {
      state = {
        ...state,
        apps: Array.isArray(apps) ? apps : [],
        lastRefreshAt: Date.now(),
      };
      return state;
    },
    setMode(mode) {
      state = {
        ...state,
        mode,
      };
      return state;
    },
    selectApp(app) {
      state = {
        ...state,
        mode: MODE_DIRECTION,
        directionPage: 0,
        selectedAppPath: app && app.appPath ? app.appPath : "",
        selectedAppName: app && app.appName ? app.appName : "",
        selectedWindowKey: "",
      };
      return state;
    },
    selectWindow(windowKey) {
      state = {
        ...state,
        selectedWindowKey: windowKey || "",
      };
      return state;
    },
    clearSelection() {
      state = {
        ...state,
        mode: MODE_LIST,
        directionPage: 0,
        selectedAppPath: "",
        selectedAppName: "",
        selectedWindowKey: "",
        lastMoveSummary: null,
      };
      return state;
    },
    setPage(page) {
      state = {
        ...state,
        currentPage: Math.max(0, page),
      };
      return state;
    },
    setDirectionPage(page) {
      state = {
        ...state,
        directionPage: Math.max(0, page),
      };
      return state;
    },
    setLastMoveSummary(summary) {
      state = {
        ...state,
        lastMoveSummary: summary || null,
      };
      return state;
    },
    reset() {
      state = createInitialState();
      return state;
    },
  };
}

module.exports = {
  MODE_LIST,
  MODE_DIRECTION,
  createStateStore,
};
