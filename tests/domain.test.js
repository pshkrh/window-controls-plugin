"use strict";

const assert = require("node:assert/strict");

const { mapDisplays } = require("../com.pshkrh.window-controls.sdPlugin/bin/lib/domain/displays");
const { aggregateApps } = require("../com.pshkrh.window-controls.sdPlugin/bin/lib/domain/apps");
const { createMoveEngine } = require("../com.pshkrh.window-controls.sdPlugin/bin/lib/domain/move");

async function testAggregateApps() {
  const screens = [
    {
      id: "1",
      isPrimary: true,
      deviceName: "Built-in Retina Display",
      manufacturerId: "APP",
      modelId: "A053",
      bounds: { x: 0, y: 0, width: 1470, height: 956 },
      workAreaBounds: { x: 0, y: 0, width: 1470, height: 922 },
    },
    {
      id: "2",
      isPrimary: false,
      deviceName: "PG27UCDM",
      manufacturerId: "AUS",
      modelId: "27f5",
      bounds: { x: 1470, y: 0, width: 2560, height: 1440 },
      workAreaBounds: { x: 1470, y: 0, width: 2560, height: 1409 },
    },
  ];

  const displayMap = mapDisplays(screens);
  const windows = [
    {
      title: "Brave",
      bounds: { x: 20, y: 20, width: 1000, height: 700 },
      application: { name: "Brave Browser", path: "/Applications/Brave Browser.app" },
    },
    {
      title: "Brave 2",
      bounds: { x: 1500, y: 20, width: 1200, height: 800 },
      application: { name: "Brave Browser", path: "/Applications/Brave Browser.app" },
    },
    {
      title: "Slack",
      bounds: { x: 1700, y: 100, width: 900, height: 700 },
      application: { name: "Slack", path: "/Applications/Slack.app" },
    },
    {
      title: "Notes A",
      bounds: { x: 100, y: 120, width: 700, height: 500 },
      application: { name: "Notes", bundleURL: "file:///System/Applications/Notes.app" },
    },
    {
      title: "Notes B",
      bounds: { x: 1800, y: 120, width: 700, height: 500 },
      application: { name: "Notes", executableURL: "/System/Applications/Notes.app/Contents/MacOS/Notes" },
    },
  ];

  const apps = aggregateApps(windows, displayMap);
  const brave = apps.find((app) => app.appName === "Brave Browser");
  const slack = apps.find((app) => app.appName === "Slack");
  const notes = apps.find((app) => app.appName === "Notes");

  assert.ok(brave, "Expected Brave app aggregation");
  assert.equal(brave.windowCount, 2);
  assert.equal(brave.displayBadge, "1+2");

  assert.ok(slack, "Expected Slack app aggregation");
  assert.equal(slack.windowCount, 1);
  assert.equal(slack.displayBadge, "2");

  assert.ok(notes, "Expected Notes app aggregation");
  assert.equal(notes.windowCount, 2);
  assert.equal(notes.displayBadge, "1+2");
  assert.equal(notes.appPath, "/System/Applications/Notes.app");
}

async function testMoveEngine() {
  const screens = [
    {
      id: "1",
      isPrimary: true,
      deviceName: "Built-in Retina Display",
      manufacturerId: "APP",
      modelId: "A053",
      bounds: { x: 0, y: 0, width: 1470, height: 956 },
      workAreaBounds: { x: 0, y: 0, width: 1470, height: 922 },
    },
    {
      id: "2",
      isPrimary: false,
      deviceName: "PG27UCDM",
      manufacturerId: "AUS",
      modelId: "27f5",
      bounds: { x: 1470, y: 0, width: 2560, height: 1440 },
      workAreaBounds: { x: 1470, y: 0, width: 2560, height: 1409 },
    },
  ];

  const movedBounds = [];

  const windowA = {
    title: "Brave A",
    bounds: { x: 1600, y: 50, width: 1500, height: 900 },
    application: { name: "Brave Browser", bundleURL: "file:///Applications/Brave%20Browser.app" },
    async setBounds(options) {
      movedBounds.push(options);
    },
  };

  const windowB = {
    title: "Brave B",
    bounds: { x: 1700, y: 100, width: 1000, height: 700 },
    application: { name: "Brave Browser", executableURL: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" },
    async setBounds() {
      throw new Error("simulated failure");
    },
  };

  const windowOther = {
    title: "Slack",
    bounds: { x: 20, y: 20, width: 900, height: 700 },
    application: { name: "Slack", path: "/Applications/Slack.app" },
    async setBounds() {
      throw new Error("should not be called");
    },
  };

  const backend = {
    async getScreens() {
      return screens;
    },
    async getWindows() {
      return [windowA, windowB, windowOther];
    },
    async setWindowBounds(windowRef, options) {
      return windowRef.setBounds(options);
    },
  };

  const engine = createMoveEngine(backend);
  const summary = await engine.moveAppWindowsToDirection(
    "/Applications/Brave Browser.app",
    "Brave Browser",
    "left"
  );

  assert.equal(summary.total, 2);
  assert.equal(summary.moved, 1);
  assert.equal(summary.failed, 1);
  assert.equal(movedBounds.length, 1);
  assert.equal(movedBounds[0].screenId, "1");
  assert.ok(movedBounds[0].bounds.width <= 1470);
  assert.ok(movedBounds[0].bounds.height <= 922);
}

async function run() {
  await testAggregateApps();
  await testMoveEngine();
  console.log("domain tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
