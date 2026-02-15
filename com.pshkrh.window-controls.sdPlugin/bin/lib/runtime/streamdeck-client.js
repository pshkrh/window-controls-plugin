"use strict";

const fs = require("node:fs");
const path = require("node:path");

let WebSocketImpl = globalThis.WebSocket;
if (!WebSocketImpl) {
  try {
    // Node 20 in Stream Deck does not provide a global WebSocket.
    // eslint-disable-next-line global-require
    WebSocketImpl = require("ws");
  } catch {
    WebSocketImpl = null;
  }
}

function parseLaunchArguments(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("-")) {
      continue;
    }
    const value = argv[i + 1];
    args[key.slice(1)] = value;
  }
  return args;
}

const DEBUG_LOG_PATH = path.join(
  process.env.HOME || "",
  "Library",
  "Logs",
  "ElgatoStreamDeck",
  "window-controls-debug-live.log"
);

function debugLog(line) {
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // no-op
  }
}

function createStreamDeckClient() {
  let socket = null;
  let pluginUUID = "";
  let registerEvent = "";
  const handlers = new Set();

  function send(message) {
    if (!socket || socket.readyState !== 1) {
      return;
    }
    socket.send(JSON.stringify(message));
  }

  return {
    connect() {
      const launchArgs = parseLaunchArguments(process.argv.slice(2));
      const port = launchArgs.port;
      pluginUUID = launchArgs.pluginUUID || "";
      registerEvent = launchArgs.registerEvent || "registerPlugin";

      if (!port) {
        throw new Error("Stream Deck port argument was not provided by host.");
      }

      if (!WebSocketImpl) {
        throw new Error("No WebSocket implementation available. Install dependency 'ws'.");
      }

      socket = new WebSocketImpl(`ws://127.0.0.1:${port}`);

      socket.addEventListener("open", () => {
        debugLog(`WS open registerEvent=${registerEvent}`);
        send({
          event: registerEvent,
          uuid: pluginUUID,
        });
      });

      socket.addEventListener("message", (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        for (const handler of handlers) {
          handler(data);
        }
      });

      socket.addEventListener("error", () => {
        // The host process manages retries and relaunch.
      });
    },
    onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    setSettings(context, settings) {
      send({
        event: "setSettings",
        context,
        payload: settings,
      });
    },
    setImage(context, imageDataUrl) {
      const imageString = typeof imageDataUrl === "string" ? imageDataUrl : String(imageDataUrl || "");
      const prefix = imageString.slice(0, 40).replace(/\s+/g, " ");
      const suffix = imageString.startsWith("data:image/") ? "dataurl" : path.basename(imageString);
      debugLog(`setImage ctx=${context} len=${imageString.length} prefix=${prefix} tail=${suffix}`);
      for (const target of [0, 1]) {
        send({
          event: "setImage",
          context,
          payload: {
            image: imageDataUrl,
            target,
            state: 0,
          },
        });
      }
    },
    setTitle(context, title) {
      send({
        event: "setTitle",
        context,
        payload: {
          title: title || "",
          target: 0,
        },
      });
    },
    showAlert(context) {
      send({
        event: "showAlert",
        context,
      });
    },
    showOk(context) {
      send({
        event: "showOk",
        context,
      });
    },
    switchToProfile(context, device, profile) {
      if (!device) {
        return;
      }
      if (!pluginUUID) {
        return;
      }
      const payload = {};
      if (profile) {
        payload.profile = profile;
      }
      send({
        event: "switchToProfile",
        context: pluginUUID,
        device,
        payload,
      });
    },
    logMessage(message) {
      send({
        event: "logMessage",
        payload: {
          message: `[Window Controls] ${message}`,
        },
      });
    },
  };
}

module.exports = {
  createStreamDeckClient,
};
