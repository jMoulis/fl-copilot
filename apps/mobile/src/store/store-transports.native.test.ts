import { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ApiClient } from "@fl-copilot/api-client";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import { storeTransportsFixture } from "../../../../scripts/test-store-transports-fixtures";
import { runLocalMigrations } from "../db/migrations";
import { StoreContextRepository } from "../store/context-repository";
import StoreTransportsScreen from "../app/store-transports";
const runtime = vi.hoisted(() => ({
  sqlite: undefined as unknown,
  storeId: "11111111-1111-4111-8111-111111111111",
  role: "MANAGER",
  sync: vi.fn(async () => {}),
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: "Input",
  Switch: "Switch",
}));
vi.mock("expo-router", () => ({ router: { back: vi.fn(), push: vi.fn() } }));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: { id: "22222222-2222-4222-8222-222222222222" },
      stores: [{ storeId: runtime.storeId, role: runtime.role }],
    },
    withAccessToken: async (fn: (s: string) => unknown) => fn("test-token"),
  }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({
    sqlite: runtime.sqlite,
    deviceId: "33333333-3333-4333-8333-333333333333",
  }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ syncNow: runtime.sync, lastSyncedAt: null }),
}));
vi.mock("../components/use-unsaved-form", () => ({ useUnsavedForm: vi.fn() }));
vi.mock("../config/environment", () => ({
  getApiBaseUrl: () => "https://api.test.invalid",
}));
vi.mock("../components/ui", () => ({
  AppScreen: "Screen",
  AppHeader: "Header",
  SectionCard: "Card",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  InlineAlert: ({ message }: { message: string }) =>
    createElement("Text", {}, message),
}));
vi.mock("../components/dashboard", () => ({ SegmentedControl: "Segmented" }));
let raw: DatabaseSync, tree: ReactTestRenderer | undefined;
const text = () =>
  tree!.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => n.children.filter((x) => typeof x === "string").join(""))
    .join(" ");
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  runtime.role = "MANAGER";
  runtime.sync.mockReset();
  raw = new DatabaseSync(":memory:");
  const db = new VisualTestDatabase(raw);
  runtime.sqlite = db;
  await runLocalMigrations(db);
  const s = {
    ...storeContextFixture(),
    id: runtime.storeId,
    storeId: runtime.storeId,
  };
  await new StoreContextRepository(db).save(s, {
    commandId: "44444444-4444-4444-8444-444444444444",
    deviceId: "33333333-3333-4333-8333-333333333333",
  });
});
afterEach(async () => {
  await act(() => tree?.unmount());
  raw.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  tree!.root.find(
    (n) => String(n.type) === "Button" && n.props.label === label,
  );
it("discovers from a typed address, saves selection through SQLite/Outbox and keeps it if network sync fails", async () => {
  const p = storeTransportsFixture();
  const api = vi
    .spyOn(ApiClient.prototype, "nearbyTransports")
    .mockResolvedValue({
      storeId: runtime.storeId,
      location: p.location,
      candidates: [],
      lines: p.lines,
      retrievedAt: p.detectedAt,
      partial: false,
    });
  runtime.sync.mockRejectedValue(Error("offline"));
  await act(async () => {
    tree = create(createElement(StoreTransportsScreen));
  });
  await act(() =>
    tree!.root
      .find(
        (n) =>
          String(n.type) === "Input" &&
          n.props.accessibilityLabel === "Adresse du magasin",
      )
      .props.onChangeText(p.address),
  );
  await act(() => button("Rechercher les arrêts et lignes").props.onPress());
  expect(api).toHaveBeenCalledWith(
    "test-token",
    runtime.storeId,
    expect.objectContaining({
      address: p.address,
      radiusMetres: 800,
      point: null,
    }),
  );
  expect(text()).toContain("Les Agnettes");
  await act(() =>
    tree!.root
      .findAll((n) => String(n.type) === "Switch")[0]!
      .props.onValueChange(false),
  );
  await act(() =>
    tree!.root
      .findAll((n) => String(n.type) === "Switch")
      .find((n) => n.props.accessibilityLabel === "Retards")!
      .props.onValueChange(false),
  );
  await act(() => button("Enregistrer la sélection").props.onPress());
  const saved = await new StoreContextRepository(
    runtime.sqlite as VisualTestDatabase,
  ).get(runtime.storeId);
  expect(saved?.entity.transports?.lines[0]?.enabled).toBe(false);
  expect(saved?.entity.transportAlertTypes).not.toContain("DELAYS");
  expect(saved?.entity.transportAlertTypes).toContain("INFORMATION");
  expect(saved?.syncState).toBe("PENDING");
  expect(text()).toContain("À synchroniser");
  expect(raw.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()?.n).toBe(2);
});
it("does not offer an employee editable settings or launch provider calls", async () => {
  runtime.role = "EMPLOYEE";
  const api = vi.spyOn(ApiClient.prototype, "nearbyTransports");
  await act(async () => {
    tree = create(createElement(StoreTransportsScreen));
  });
  expect(button("Rechercher les arrêts et lignes").props.disabled).toBe(true);
  await act(() => button("Rechercher les arrêts et lignes").props.onPress());
  expect(api).not.toHaveBeenCalled();
});
