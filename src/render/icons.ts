import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";

import { resolveInstalledAppPathByName } from "../domain/app-utils";

export const TRANSPARENT_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sJd7s8AAAAASUVORK5CYII=";
const ICON_THEME_VERSION = "v5";

function toDataUrl(pngPath: string): string {
  const buffer = fs.readFileSync(pngPath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function toPluginImageReference(pngPath: string, pluginRootDirectory: string): string {
  return toDataUrl(pngPath);
}

function ensureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function createHash(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function runRendererScript(rendererScriptPath: string, args: string[]): void {
  childProcess.execFileSync("python3", [rendererScriptPath, ...args], {
    stdio: "ignore",
  });
}

export function createIconRenderer(options: { cacheDirectory: string; rendererScriptPath: string; pluginRootDirectory?: string }) {
  const cacheDirectory = options.cacheDirectory;
  const rendererScriptPath = options.rendererScriptPath;
  const pluginRootDirectory = options.pluginRootDirectory || "";
  const appImageCache = new Map<string, string>();
  const controlImageCache = new Map<string, string>();
  const appImagePending = new Set<string>();

  ensureDirectory(cacheDirectory);

  return {
    transparentImage: TRANSPARENT_PNG_DATA_URL,
    getAppIconDataUrl(
      appPath: string,
      badgeText: string,
      selected: boolean = false,
      allowGenerate: boolean = true,
      appName: string = ""
    ): string | null {
      const safePath = appPath || "";
      const safeAppName = appName || "";
      const resolvedPath = safePath || resolveInstalledAppPathByName(safeAppName);
      const safeBadge = badgeText || "";
      const safeSelected = selected ? "1" : "0";
      const cacheKey = `${resolvedPath}|${safeAppName}|${safeBadge}|${safeSelected}`;

      if (appImageCache.has(cacheKey)) {
        return appImageCache.get(cacheKey)!;
      }

      if (appImagePending.has(cacheKey)) {
        return null;
      }

      const cacheFile = path.join(cacheDirectory, `${createHash(`app:${ICON_THEME_VERSION}:${cacheKey}`)}.png`);
      if (!fs.existsSync(cacheFile)) {
        if (!allowGenerate) {
          return null;
        }

        try {
          appImagePending.add(cacheKey);
          runRendererScript(rendererScriptPath, ["app", resolvedPath, safeBadge, safeSelected, cacheFile]);
        } catch {
          return null;
        } finally {
          appImagePending.delete(cacheKey);
        }
      }

      let dataUrl: string;
      try {
        dataUrl = toPluginImageReference(cacheFile, pluginRootDirectory);
      } catch {
        return null;
      }

      appImageCache.set(cacheKey, dataUrl);
      return dataUrl;
    },
    prewarmAppIcon(appPath: string, badgeText: string, selected: boolean = false, appName: string = ""): void {
      const safePath = appPath || "";
      const safeAppName = appName || "";
      const resolvedPath = safePath || resolveInstalledAppPathByName(safeAppName);
      const safeBadge = badgeText || "";
      const safeSelected = selected ? "1" : "0";
      const cacheKey = `${resolvedPath}|${safeAppName}|${safeBadge}|${safeSelected}`;

      if (appImageCache.has(cacheKey)) {
        return;
      }

      const cacheFile = path.join(cacheDirectory, `${createHash(`app:${ICON_THEME_VERSION}:${cacheKey}`)}.png`);
      if (fs.existsSync(cacheFile)) {
        try {
          const dataUrl = toPluginImageReference(cacheFile, pluginRootDirectory);
          appImageCache.set(cacheKey, dataUrl);
        } catch {
          // no-op
        }
        return;
      }

      if (appImagePending.has(cacheKey)) {
        return;
      }

      appImagePending.add(cacheKey);
      childProcess.execFile(
        "python3",
        [rendererScriptPath, "app", resolvedPath, safeBadge, safeSelected, cacheFile],
        {
          stdio: "ignore",
        },
        () => {
          appImagePending.delete(cacheKey);
          if (fs.existsSync(cacheFile)) {
            try {
              const dataUrl = toPluginImageReference(cacheFile, pluginRootDirectory);
              appImageCache.set(cacheKey, dataUrl);
            } catch {
              // no-op
            }
          }
        }
      );
    },
    hasPendingAppIcons(): boolean {
      return appImagePending.size > 0;
    },
    getControlIconDataUrl(role: string, label: string): string {
      const safeRole = role || "control";
      const safeLabel = label || "";
      const cacheKey = `${safeRole}|${safeLabel}`;

      if (controlImageCache.has(cacheKey)) {
        return controlImageCache.get(cacheKey)!;
      }

      const cacheFile = path.join(cacheDirectory, `${createHash(`control:${ICON_THEME_VERSION}:${cacheKey}`)}.png`);
      if (!fs.existsSync(cacheFile)) {
        try {
          runRendererScript(rendererScriptPath, ["control", safeRole, safeLabel, cacheFile]);
        } catch {
          return TRANSPARENT_PNG_DATA_URL;
        }
      }

      const dataUrl = toPluginImageReference(cacheFile, pluginRootDirectory);
      controlImageCache.set(cacheKey, dataUrl);
      return dataUrl;
    },
  };
}
