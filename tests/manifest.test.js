"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.resolve(
  __dirname,
  "../com.pshkrh.window-controls.sdPlugin/manifest.json"
);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

assert.equal(manifest.UUID, "com.pshkrh.window-controls");
assert.equal(manifest.CodePath, "bin/plugin.js");
assert.equal(manifest.Nodejs.Version, "20");
assert.ok(Array.isArray(manifest.Actions));
assert.equal(manifest.Actions[0].UUID, "com.pshkrh.window-controls.key");

console.log("manifest tests passed");
