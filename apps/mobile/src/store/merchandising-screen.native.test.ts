import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import StoreSettingsScreen from "../app/store-settings";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { StoreContextRepository } from "./context-repository";
const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  sync: vi.fn(),
  unsaved: vi.fn(),
  focused: true,
}));
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({ syncNow: runtime.sync }),
}));
vi.mock("@/store/position", () => import("./position"));
vi.mock("@/store/merchandising-editor", () => import("./merchandising-editor"));
vi.mock("@/store/merchandising-draft", () => import("./merchandising-draft"));
vi.mock("@/store/context-repository", () => import("./context-repository"));
vi.mock("@/store/context-presentation", () => import("./context-presentation"));
vi.mock("@/components/use-unsaved-form", () => ({
  useUnsavedForm: runtime.unsaved,
}));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  useFocusEffect: (callback: () => void | (() => void)) => {
    const focused = runtime.focused;
    useEffect(() => (focused ? callback() : undefined), [callback, focused]);
  },
}));
vi.mock("react-native", () => ({
  Text: "Text",
  TextInput: "Input",
  View: "View",
  Switch: "Switch",
  Pressable: "Pressable",
  Alert: { alert: vi.fn() },
  Platform: { OS: "ios" },
}));
vi.mock("../components/dashboard", () => ({ SegmentedControl: "Segmented" }));
vi.mock("@/components/ui", () => ({
  AppScreen: "Screen",
  AppHeader: "Header",
  SectionCard: "Card",
  SecondaryButton: "Button",
  PrimaryButton: "Button",
  InlineAlert: "Alert",
  MenuRow: "Menu",
}));
vi.mock("../components/ui", () => ({
  SectionCard: "Card",
  SecondaryButton: "Button",
}));
let tree: ReactTestRenderer | undefined, db: DatabaseSync;
const input = (label: string) =>
  tree!.root.find(
    (n) => String(n.type) === "Input" && n.props.accessibilityLabel === label,
  );
const button = (label: string) =>
  tree!.root.find(
    (n) => String(n.type) === "Button" && n.props.label === label,
  );
async function setup(role = "MANAGER") {
  db = new DatabaseSync(":memory:");
  const sqlite = new ReceiptTestDatabase(db);
  await runLocalMigrations(sqlite);
  const settings = storeContextFixture(),
    ownerId = randomUUID(),
    deviceId = randomUUID();
  const repo = new StoreContextRepository(sqlite);
  await repo.save(settings, { commandId: randomUUID(), deviceId });
  runtime.session = {
    user: { id: ownerId },
    stores: [{ storeId: settings.storeId, name: "Magasin test", role }],
  };
  runtime.database = { sqlite, deviceId };
  await act(() => {
    tree = create(createElement(StoreSettingsScreen));
  });
  return { repo, settings, sqlite };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.sync.mockReset().mockRejectedValue(Error("OFFLINE"));
  runtime.unsaved.mockReset();
  const log = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      log(...args);
  });
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  db?.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("saves declared active TGs, circulation and a qualified zone locally through the normal settings writer", async () => {
  const f = await setup();
  expect(input("Nombre de TG actives F&L").props.value).toBe("");
  await act(() => input("Nombre de TG actives F&L").props.onChangeText("2"));
  await act(() =>
    input("Circulation principale déclarée").props.onChangeText(
      "Allée centrale entre les îlots ; TG1 en premier",
    ),
  );
  await act(() => button("Emplacements et zones (0)").props.onPress());
  await act(() => button("Ajouter un emplacement").props.onPress());
  await act(() => input("Nom de l’emplacement").props.onChangeText("TG1"));
  const select = (label: string) =>
    tree!.root.find(
      (n) => String(n.type) === "Segmented" && n.props.label === label,
    );
  await act(() => select("Type de TG1").props.onChange("TG"));
  await act(() => select("Activité F&L de TG1").props.onChange("ACTIVE"));
  expect(select("Zone de TG1").props.value).toBe("UNKNOWN");
  await act(() => select("Zone de TG1").props.onChange("COLD"));
  expect(runtime.unsaved.mock.calls.some(([dirty]) => dirty === true)).toBe(
    true,
  );
  await act(async () =>
    button("Enregistrer les réglages du magasin").props.onPress(),
  );
  const saved = await f.repo.get(f.settings.storeId);
  expect(saved?.entity.merchandising).toMatchObject({
    activeTgCount: 2,
    circulation: "Allée centrale entre les îlots ; TG1 en premier",
    zones: [{ label: "TG1", kind: "TG", active: true, heat: "COLD" }],
  });
  expect(saved?.syncState).toBe("PENDING");
  expect(input("Circulation principale déclarée").props.value).toContain(
    "TG1 en premier",
  );
  expect(
    db.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get()!.n,
  ).toBe(0);
  expect(db.prepare("SELECT COUNT(*) n FROM store_layouts").get()!.n).toBe(0);
});
it("refuses inconsistent counts without losing input and makes merchandising read-only for a helper", async () => {
  const f = await setup();
  await act(() => input("Nombre de TG actives F&L").props.onChangeText("999"));
  await act(async () =>
    button("Enregistrer les réglages du magasin").props.onPress(),
  );
  expect((await f.repo.get(f.settings.storeId))?.entity.version).toBe(1);
  expect(input("Nombre de TG actives F&L").props.value).toBe("999");
  runtime.session = {
    user: { id: randomUUID() },
    stores: [{ storeId: f.settings.storeId, name: "Test", role: "ASSISTANT" }],
  };
  await act(() => tree!.update(createElement(StoreSettingsScreen)));
  expect(input("Nombre de TG actives F&L").props.editable).toBe(false);
  expect(button("Enregistrer les réglages du magasin").props.disabled).toBe(
    true,
  );
});
