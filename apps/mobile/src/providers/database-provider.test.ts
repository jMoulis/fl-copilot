import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DatabaseProvider,
  useDatabaseRestore,
  useLocalDatabase,
} from "./database-provider";
import type { PreparedLocalCopy } from "../db/local-copy-contracts";
const runtime = vi.hoisted(() => ({
  initialize: vi.fn(),
  recover: vi.fn(),
  activate: vi.fn(),
  unmounted: false,
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "Spinner",
  View: "View",
  Text: "Text",
  StyleSheet: { create: <T>(v: T) => v },
}));
vi.mock("../db/client", () => ({
  initializeLocalDatabase: runtime.initialize,
  recoverLocalDatabase: runtime.recover,
}));
vi.mock("../db/local-copies-native", () => ({
  activatePreparedLocalCopy: runtime.activate,
}));
vi.mock("../db/database-startup-screen", () => ({
  DatabaseStartupScreen: "Startup",
}));
let rendered: ReactTestRenderer | undefined,
  request: ReturnType<typeof useDatabaseRestore>,
  database: ReturnType<typeof useLocalDatabase>;
const db = {
  sqlite: { closeAsync: vi.fn() },
  orm: {},
  deviceId: "device",
  schemaVersion: 66,
};
function Probe() {
  request = useDatabaseRestore();
  database = useLocalDatabase();
  useEffect(
    () => () => {
      runtime.unmounted = true;
    },
    [],
  );
  return createElement("Operational");
}
async function mount() {
  await act(async () => {
    rendered = create(
      createElement(DatabaseProvider, {}, createElement(Probe)),
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  runtime.unmounted = false;
  runtime.initialize.mockReset().mockResolvedValue(db);
  runtime.activate.mockReset();
  db.sqlite.closeAsync.mockReset();
});
afterEach(async () => {
  await act(async () => rendered?.unmount());
  rendered = undefined;
  vi.unstubAllGlobals();
});
it("removes operational providers, drains logout, activates once and requires restart without opening or closing another live database", async () => {
  await mount();
  expect(database).toBe(db);
  let release!: () => void;
  const logout = new Promise<void>((r) => {
    release = r;
  });
  const copy = { deviceId: "original" } as PreparedLocalCopy;
  runtime.activate.mockImplementation(async (value) => {
    expect(runtime.unmounted).toBe(true);
    expect(value).toBe(copy);
  });
  await act(async () => request(copy, logout));
  expect(
    rendered!.root.findAll((node) => String(node.type) === "Operational"),
  ).toHaveLength(0);
  expect(runtime.activate).not.toHaveBeenCalled();
  await act(async () => release());
  expect(runtime.activate).toHaveBeenCalledTimes(1);
  expect(runtime.initialize).toHaveBeenCalledTimes(1);
  expect(db.sqlite.closeAsync).not.toHaveBeenCalled();
  expect(JSON.stringify(rendered!.toJSON())).toContain("Fermez puis rouvrez");
});
it("does not activate when logout cannot finish and never silently restores operational content", async () => {
  await mount();
  const failed = Promise.reject(Error("KEYCHAIN_UNAVAILABLE"));
  await act(async () => request({} as PreparedLocalCopy, failed));
  expect(runtime.activate).not.toHaveBeenCalled();
  expect(
    rendered!.root.findAll((node) => String(node.type) === "Operational"),
  ).toHaveLength(0);
  expect(JSON.stringify(rendered!.toJSON())).toContain(
    "n’a pas pu être confirmée",
  );
  expect(runtime.initialize).toHaveBeenCalledTimes(1);
});
