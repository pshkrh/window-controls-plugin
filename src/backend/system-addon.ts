import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";

export interface WindowBackend {
  addonPath: string;
  getForegroundWindow(): Promise<any>;
  getScreens(): Promise<any[]>;
  getWindows(): Promise<any[]>;
  setWindowBounds(windowRef: any, options: Record<string, any>): Promise<void>;
}

function resolveAddonPath(baseDir: string): string {
  return path.resolve(baseDir, "addon", "mac", "System.node");
}

function normalizeError(error: any, addonPath: string): Error {
  const wrapped = new Error(error?.message || String(error));
  (wrapped as any).name = error?.name || "WindowBackendError";
  (wrapped as any).cause = error;
  (wrapped as any).addonPath = addonPath;
  return wrapped;
}

export function createWindowBackend(baseDir: string): WindowBackend {
  const addonPath = resolveAddonPath(baseDir);

  if (process.platform !== "darwin") {
    throw new Error("Window Controls plugin currently supports macOS only.");
  }

  if (!fs.existsSync(addonPath)) {
    throw new Error(
      `System.node not found at ${addonPath}. Run scripts/install-window-controls.sh to copy the native backend.`
    );
  }

  let addon: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    addon = require(addonPath);
  } catch (error) {
    throw normalizeError(error, addonPath);
  }

  if (!addon?.windowManager) {
    throw new Error("Invalid native addon: windowManager API is missing.");
  }

  return {
    addonPath,
    async getForegroundWindow() {
      return addon.windowManager.getForegroundWindow();
    },
    async getScreens() {
      return addon.windowManager.getScreens();
    },
    async getWindows() {
      return addon.windowManager.getWindows();
    },
    async setWindowBounds(windowRef: any, options: Record<string, any>) {
      return windowRef.setBounds(options);
    },
  };
}

export function isPermissionError(error: any): boolean {
  if (!error) {
    return false;
  }

  if (error.name === "PermissionError") {
    return true;
  }

  const message = String(error.message || "").toLowerCase();
  return message.includes("window management unavailable") || message.includes("permission");
}

export function openPermissionsSettings(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const targets = [
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  ];

  for (const target of targets) {
    childProcess.execFile("open", [target], () => {
      // no-op
    });
  }
}
