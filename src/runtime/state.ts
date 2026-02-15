export const MODE_LIST = "list";
export const MODE_DIRECTION = "direction";

function createInitialState() {
  return {
    mode: MODE_LIST,
    currentPage: 0,
    directionPage: 0,
    selectedAppPath: "",
    selectedAppName: "",
    selectedWindowKey: "",
    apps: [] as any[],
    lastRefreshAt: 0,
    lastMoveSummary: null as any,
  };
}

export function createStateStore() {
  let state = createInitialState();

  return {
    getState() {
      return state;
    },
    update(partialState: Record<string, any>) {
      state = { ...state, ...partialState };
      return state;
    },
    setApps(apps: any[]) {
      state = {
        ...state,
        apps: Array.isArray(apps) ? apps : [],
        lastRefreshAt: Date.now(),
      };
      return state;
    },
    setMode(mode: string) {
      state = { ...state, mode };
      return state;
    },
    selectApp(app: any) {
      state = {
        ...state,
        mode: MODE_DIRECTION,
        directionPage: 0,
        selectedAppPath: app?.appPath || "",
        selectedAppName: app?.appName || "",
        selectedWindowKey: "",
      };
      return state;
    },
    selectWindow(windowKey: string) {
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
    setPage(page: number) {
      state = {
        ...state,
        currentPage: Math.max(0, page),
      };
      return state;
    },
    setDirectionPage(page: number) {
      state = {
        ...state,
        directionPage: Math.max(0, page),
      };
      return state;
    },
    setLastMoveSummary(summary: any) {
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
