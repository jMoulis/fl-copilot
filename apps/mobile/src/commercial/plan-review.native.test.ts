import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CommercialPlanValidationView } from "./plan-validation-view";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import { storeContextFixture } from "../../../../scripts/test-store-context-fixtures";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { ProductMasterRepository } from "../products/product-master-repository";
import { applyCommercialVisualReading } from "./visual-repository";
import { applyCommercialChoice } from "./offer-choice-repository";
import { applyCommercialPreparation } from "./week-preparation-repository";
import { applyStoreContext } from "../store/context-repository";
const env = vi.hoisted(() => ({
  database: undefined as unknown,
  session: undefined as unknown,
  sync: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/dates/calendar", () => import("../dates/calendar"));
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({ session: env.session }),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => env.database,
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({ syncNow: env.sync }),
}));
vi.mock("@/components/ui", () => ({
  SectionCard: "Card",
  SecondaryButton: "Button",
  PrimaryButton: "Button",
  InlineAlert: "Alert",
}));
vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.mock("expo-router", () => ({
  router: { push: env.push },
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => randomUUID(),
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_: unknown, s: string) =>
    createHash("sha256").update(s).digest("hex"),
}));
vi.mock("./original-button", () => ({ CommercialOriginalButton: "Original" }));
vi.mock("./physical-allocation-card", () => ({
  PhysicalAllocationCard: "Allocation",
}));
let tree: ReactTestRenderer | undefined, db: DatabaseSync;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  env.push.mockReset();
  env.sync.mockReset().mockRejectedValue(Error("OFFLINE"));
  const log = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      log(...args);
  });
});
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  db?.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup(role = "MANAGER") {
  db = new DatabaseSync(":memory:");
  const sqlite = new ReceiptTestDatabase(db),
    f = await commercialPlanFixture(),
    deviceId = randomUUID();
  await runLocalMigrations(sqlite);
  await new ProductMasterRepository(sqlite).upsertProduct(f.product, {
    commandId: randomUUID(),
    deviceId,
  });
  await applyCommercialVisualReading(sqlite, f.storeId, f.reading);
  await applyCommercialChoice(sqlite, f.storeId, f.choice);
  await applyCommercialPreparation(sqlite, f.storeId, f.preparation);
  env.database = { sqlite, deviceId };
  env.session = {
    user: { id: randomUUID() },
    stores: [{ storeId: f.storeId, role }],
  };
  await act(() => {
    tree = create(
      createElement(CommercialPlanValidationView, {
        preparation: f.preparation,
        unsavedChanges: false,
      }),
    );
  });
  return { sqlite, f };
}
const confirm = () =>
  tree!.root.find(
    (n) =>
      String(n.type) === "Button" &&
      n.props.label === "Valider mon plan de semaine",
  );
it("shows terms and TGs with one confirmation, no separate certification, and ignores a same-turn double tap", async () => {
  const { f } = await setup();
  expect(JSON.stringify(tree!.toJSON())).toContain(f.choice.rawProductLabel);
  expect(JSON.stringify(tree!.toJSON())).toContain(
    f.preparation.placements[0]!.label,
  );
  expect(tree!.root.findAll((n) => String(n.type) === "Switch")).toHaveLength(
    0,
  );
  expect(confirm().props.disabled).toBe(false);
  expect(
    db.prepare("SELECT COUNT(*) n FROM commercial_validated_offers").get(),
  ).toEqual({ n: 0 });
  await act(async () => {
    const press = confirm().props.onPress;
    press();
    press();
    await new Promise((r) => setTimeout(r, 25));
  });
  expect(
    db
      .prepare("SELECT COUNT(*) n FROM commercial_offer_validation_history")
      .get(),
  ).toEqual({ n: 1 });
  expect(
    db.prepare("SELECT COUNT(*) n FROM commercial_plan_history").get(),
  ).toEqual({ n: 1 });
  expect(env.push).toHaveBeenCalledTimes(1);
  expect(env.sync).toHaveBeenCalledTimes(1);
  expect(
    db.prepare("SELECT COUNT(*) n FROM commercial_execution_tasks").get(),
  ).toEqual({ n: 0 });
});
it("blocks helpers and keeps a changed context from silently confirming an old review", async () => {
  const { sqlite, f } = await setup("HELPER");
  expect(confirm().props.disabled).toBe(true);
  env.session = {
    user: { id: randomUUID() },
    stores: [{ storeId: f.storeId, role: "MANAGER" }],
  };
  await act(() =>
    tree!.update(
      createElement(CommercialPlanValidationView, {
        preparation: f.preparation,
        unsavedChanges: false,
      }),
    ),
  );
  await applyStoreContext(sqlite, f.storeId, {
    ...storeContextFixture(),
    id: f.storeId,
    storeId: f.storeId,
  });
  await act(async () => {
    confirm().props.onPress();
    await new Promise((r) => setTimeout(r, 25));
  });
  expect(
    tree!.root
      .findAll((n) => String(n.type) === "Alert")
      .map((n) => n.props.message)
      .join(),
  ).toContain("changé");
  expect(
    db.prepare("SELECT COUNT(*) n FROM commercial_validated_offers").get(),
  ).toEqual({ n: 0 });
  expect(env.push).not.toHaveBeenCalled();
});
