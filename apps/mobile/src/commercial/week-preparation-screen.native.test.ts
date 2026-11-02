import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WeekPreparationScreen from "../app/week-preparation";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import { testChoiceDigest } from "../../../../scripts/test-commercial-choice-fixtures";
import { runLocalMigrations } from "../db/migrations";
import { applyCommercialChoice } from "./offer-choice-repository";
import {
  applyCommercialPreparation,
  CommercialPreparationRepository,
} from "./week-preparation-repository";

const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  weekStart: "",
  focused: true,
  sync: vi.fn(async () => {}),
}));
vi.mock("@/dates/calendar", () => import("../dates/calendar"));
vi.mock("@/commercial/physical-allocation-card", () => ({
  PhysicalAllocationCard: "Physical",
}));
vi.mock("@/commercial/plan-validation-view", () => ({
  CommercialPlanValidationView: "PlanValidation",
}));
vi.mock(
  "@/commercial/week-preparation-repository",
  () => import("./week-preparation-repository"),
);
vi.mock(
  "@/commercial/offer-choice-repository",
  () => import("./offer-choice-repository"),
);
vi.mock(
  "@/commercial/choice-presentation",
  () => import("./choice-presentation"),
);
vi.mock(
  "@/commercial/preparation-presentation",
  () => import("./preparation-presentation"),
);
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({ syncNow: runtime.sync }),
}));
vi.mock("@/components/ui", () => ({
  AppScreen: "Screen",
  AppHeader: "Header",
  SectionCard: "Card",
  SecondaryButton: "Button",
  PrimaryButton: "Button",
  InlineAlert: "Alert",
  StatusBadge: "Badge",
}));
vi.mock("react-native", () => ({
  Text: "Text",
  TextInput: "Input",
  View: "View",
  Alert: { alert: vi.fn() },
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn(), push: vi.fn() },
  useLocalSearchParams: () => ({ weekStart: runtime.weekStart }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focused = runtime.focused;
    useEffect(() => (focused ? cb() : undefined), [focused, cb]);
  },
}));
vi.mock("expo-crypto", async () => {
  const { createHash, randomUUID } = await import("node:crypto");
  return {
    randomUUID,
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digestStringAsync: async (_algorithm: string, text: string) =>
      createHash("sha256").update(text).digest("hex"),
  };
});
let tree: ReactTestRenderer | undefined, db: VisualTestDatabase;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.sync.mockClear();
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  db?.raw.close();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    const node = createElement(WeekPreparationScreen);
    if (tree) tree.update(node);
    else tree = create(node);
  });
}
const hosts = (tag: string) =>
  tree!.root.findAll(
    (n) => typeof n.type === "string" && String(n.type) === tag,
  );
const field = (label: string) =>
  hosts("Input").find((n) => n.props.accessibilityLabel === label)!;
const button = (label: string) =>
  hosts("Button").find((n) => n.props.label === label)!;
async function setup(saved = true) {
  const f = await commercialPlanFixture();
  db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  await runLocalMigrations(db);
  await applyCommercialChoice(db, f.storeId, f.choice);
  if (saved) await applyCommercialPreparation(db, f.storeId, f.preparation);
  runtime.session = { stores: [{ storeId: f.storeId, role: "MANAGER" }] };
  runtime.database = { sqlite: db, deviceId: randomUUID() };
  runtime.weekStart = f.preparation.weekStart;
  await render();
  return f;
}
it("refreshes an untouched draft changed by chat/sync while away, including the version used by plan validation", async () => {
  const f = await setup();
  runtime.focused = false;
  await render();
  const changed = {
    ...f.preparation,
    version: 2,
    note: "Préparer les offres du document reçu vendredi",
  };
  await applyCommercialPreparation(db, f.storeId, changed);
  runtime.focused = true;
  await render();
  expect(field("Note pour la semaine").props.value).toBe(changed.note);
  expect(hosts("PlanValidation")[0].props.preparation).toEqual(changed);
  expect(hosts("PlanValidation")[0].props.unsavedChanges).toBe(false);
  expect(db.raw.prepare("SELECT * FROM sync_outbox").all()).toHaveLength(0);
});
it("preserves unsaved edits when a newer draft arrives and never overwrites that newer revision on save", async () => {
  const f = await setup();
  await act(() =>
    field("Note pour la semaine").props.onChangeText("Ma note en cours"),
  );
  runtime.focused = false;
  await render();
  const changed = {
    ...f.preparation,
    version: 2,
    note: "Version synchronisée",
  };
  await applyCommercialPreparation(db, f.storeId, changed);
  runtime.focused = true;
  await render();
  expect(field("Note pour la semaine").props.value).toBe("Ma note en cours");
  expect(hosts("PlanValidation")[0].props.unsavedChanges).toBe(true);
  await act(() =>
    button("Enregistrer le brouillon de semaine").props.onPress(),
  );
  expect(
    (await new CommercialPreparationRepository(db, testChoiceDigest).get(
      f.storeId,
      runtime.weekStart,
    ))!.entity,
  ).toEqual(changed);
  expect(hosts("Alert")).not.toHaveLength(0);
  expect(db.raw.prepare("SELECT * FROM sync_outbox").all()).toHaveLength(0);
});
it("saves four TGs in the selected week once and restores the draft after remount without declaring a plan or execution", async () => {
  const f = await setup(false);
  await act(() => field("Nombre de TG disponibles").props.onChangeText("4"));
  for (let i = 0; i < 4; i++)
    await act(() => button("Ajouter un emplacement TG").props.onPress());
  await act(() =>
    field("Note pour la semaine").props.onChangeText("Préparation du dimanche"),
  );
  await act(() =>
    button("Enregistrer le brouillon de semaine").props.onPress(),
  );
  const saved = (await new CommercialPreparationRepository(
    db,
    testChoiceDigest,
  ).get(f.storeId, runtime.weekStart))!.entity;
  expect(saved).toMatchObject({
    weekStart: runtime.weekStart,
    status: "DRAFT",
    tgCapacity: 4,
    note: "Préparation du dimanche",
  });
  expect(saved.placements).toHaveLength(4);
  expect(hosts("Header")[0].props.subtitle).toContain(
    "Du 05/10/2026 au 11/10/2026",
  );
  expect(hosts("Header")[0].props.title).toContain("2026");
  expect(
    db.raw
      .prepare(
        "SELECT * FROM sync_outbox WHERE entity_type='commercial_week_preparation'",
      )
      .all(),
  ).toHaveLength(1);
  await act(() => tree!.unmount());
  tree = undefined;
  await render();
  expect(field("Nombre de TG disponibles").props.value).toBe("4");
  expect(
    hosts("Input").filter(
      (n) => n.props.accessibilityLabel === "Nom de cet emplacement",
    ),
  ).toHaveLength(4);
  expect(hosts("PlanValidation")[0].props.preparation).toEqual(saved);
  for (const table of ["commercial_week_plans", "action_executions"])
    expect(db.raw.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(0);
});

it("preserves a first unsaved draft when an existing synchronized preparation arrives on return", async () => {
  const f = await setup(false);
  await act(() =>
    field("Note pour la semaine").props.onChangeText("Première saisie locale"),
  );
  runtime.focused = false;
  await render();
  await applyCommercialPreparation(db, f.storeId, f.preparation);
  runtime.focused = true;
  await render();
  expect(field("Note pour la semaine").props.value).toBe(
    "Première saisie locale",
  );
  expect(hosts("PlanValidation")).toHaveLength(0);
  expect(db.raw.prepare("SELECT * FROM sync_outbox").all()).toHaveLength(0);
});
