import { createElement, useEffect, useState, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Screen from "../app/commercial-plan";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import { runLocalMigrations } from "../db/migrations";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { applyCommercialPreparation } from "./week-preparation-repository";
import { applyCommercialPlan } from "./week-plan-repository";
vi.mock("@/commercial/tg-presentation-view", () => ({
  TgPresentationView: "TgPresentation",
}));
const env = vi.hoisted(() => ({
  sqlite: undefined as unknown,
  session: undefined as unknown,
  weekStart: "",
  focused: true,
  sync: { status: "synced", lastSyncedAt: "initial" },
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: true,
}));
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({ session: env.session }),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: env.sqlite }),
}));
vi.mock("@/sync/sync-provider", () => ({ useSync: () => env.sync }));
vi.mock("expo-router/react-navigation", () => ({
  useIsFocused: () => env.focused,
}));
vi.mock("expo-router", () => ({
  router: {
    push: env.push,
    back: env.back,
    replace: env.replace,
    canGoBack: () => env.canGoBack,
  },
  useLocalSearchParams: () => ({ weekStart: env.weekStart }),
  useFocusEffect: (cb: () => void | (() => void)) =>
    useEffect(() => (env.focused ? cb() : undefined), [cb, env.focused]),
}));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_: unknown, s: string) =>
    createHash("sha256").update(s).digest("hex"),
}));
vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.mock("@/components/ui", () => ({
  AppScreen: "Screen",
  AppHeader: "Header",
  SectionCard: "Card",
  SecondaryButton: "Button",
  PrimaryButton: "Button",
  InlineAlert: "Alert",
  EmptyState: "Empty",
}));
vi.mock("@/components/dashboard", () => ({
  DetailsDisclosure: ({
    title,
    children,
  }: {
    title: string;
    children: ReactNode;
  }) => {
    const [open, setOpen] = useState(false);
    return createElement(
      "Disclosure",
      { title, onPress: () => setOpen(!open) },
      open ? children : null,
    );
  },
}));
vi.mock("@/dates/calendar", () => import("../dates/calendar"));
vi.mock(
  "@/commercial/week-plan-repository",
  () => import("./week-plan-repository"),
);
vi.mock(
  "@/commercial/week-preparation-repository",
  () => import("./week-preparation-repository"),
);
vi.mock("@/commercial/week-plan-context", () => ({
  readWeekPlanContext: async () => ({
    choices: [],
    products: [],
    validatedOffers: [],
    preferredVersions: [],
    plan: undefined,
  }),
}));
vi.mock("@fl-copilot/commercial-core", async (original) => ({
  ...(await original<object>()),
  commercialPlanNeedsReview: () => [],
}));
vi.mock("@/commercial/plan-content", () => ({
  CommercialPlanContent: "PlanContent",
}));
vi.mock("@/commercial/plan-validation-view", () => ({
  CommercialPlanValidationView: "Review",
}));
vi.mock("@/commercial/execution-view", () => ({
  CommercialExecutionView: "Execution",
}));
vi.mock("@/commercial/substitute-view", () => ({
  WeeklySubstitutesView: "Substitutes",
}));
vi.mock("@/commercial/plan-presentation", () => ({
  commercialPlanError: (s: string) => s,
}));
vi.mock("@/commercial/preparation-presentation", () => ({
  commercialPreparationError: (s: string) => s,
}));
let db: DatabaseSync, tree: ReactTestRenderer | undefined;
const hosts = (t: string) =>
  tree!.root.findAll((n) => typeof n.type === "string" && n.type === t);
const button = (label: string) =>
  hosts("Button").find((n) => n.props.label === label)!;
async function render() {
  await act(async () => {
    if (tree) tree.update(createElement(Screen));
    else tree = create(createElement(Screen));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const log = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      log(...args);
  });
  env.focused = true;
  env.canGoBack = true;
  env.sync = { status: "synced", lastSyncedAt: "initial" };
  env.push.mockReset();
  env.back.mockReset();
  env.replace.mockReset();
});
afterEach(async () => {
  await act(() => tree?.unmount());
  tree = undefined;
  db?.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup(draft = true) {
  const f = await commercialPlanFixture();
  db = new DatabaseSync(":memory:");
  const sqlite = new ReceiptTestDatabase(db);
  await runLocalMigrations(sqlite);
  env.sqlite = sqlite;
  env.session = {
    user: { id: f.storeId },
    stores: [{ storeId: f.storeId, role: "MANAGER" }],
  };
  env.weekStart = f.preparation.weekStart;
  const preparation = {
    ...f.preparation,
    note: "Réassort régulier",
    offerRefs: [],
    placements: f.preparation.placements.map((p) => ({
      ...p,
      theme: "Crudités à l’entrée",
      offerIds: [],
      sourceIdea: null,
    })),
  };
  if (draft) await applyCommercialPreparation(sqlite, f.storeId, preparation);
  return { f, sqlite, preparation };
}
it("shows a saved qualitative draft immediately without a form or write; review is explicit and keeps its week", async () => {
  const { preparation } = await setup();
  await render();
  expect(
    hosts("Card").some(
      (n) => n.props.title === preparation.placements[0]!.label,
    ),
  ).toBe(true);
  expect(JSON.stringify(tree!.toJSON())).toContain("Crudités à l’entrée");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("Réassort régulier");
  await act(() =>
    hosts("Disclosure")
      .find((n) => n.props.title === "Consignes de la semaine")!
      .props.onPress(),
  );
  expect(JSON.stringify(tree!.toJSON())).toContain("Réassort régulier");
  expect(hosts("Empty")).toHaveLength(0);
  expect(hosts("Review")).toHaveLength(0);
  expect(hosts("Execution")).toHaveLength(0);
  await act(() => button("Modifier les choix").props.onPress());
  expect(env.push).toHaveBeenLastCalledWith({
    pathname: "/week-preparation",
    params: { weekStart: preparation.weekStart },
  });
  await act(() => button("Confirmer ces choix").props.onPress());
  expect(hosts("Review")[0]!.props.preparation).toEqual(preparation);
  expect(db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()?.n).toBe(0);
  await act(() => button("Retour").props.onPress());
  expect(env.back).toHaveBeenCalledOnce();
  expect(env.replace).not.toHaveBeenCalled();
});
it("refreshes after returning from chat and keeps current execution separate from a newer draft and archived views", async () => {
  const { f, sqlite, preparation } = await setup(false);
  await applyCommercialPlan(sqlite, f.storeId, f.plan);
  await render();
  expect(hosts("PlanContent")[0]!.props.plan).toEqual(f.plan);
  expect(hosts("Execution")[0]!.props.plan).toEqual(f.plan);
  env.focused = false;
  await render();
  const newer = { ...preparation, version: f.plan.preparation.version + 1 };
  await applyCommercialPreparation(sqlite, f.storeId, newer);
  env.focused = true;
  await render();
  expect(JSON.stringify(tree!.toJSON())).toContain("Crudités à l’entrée");
  expect(hosts("Execution")[0]!.props.plan).toEqual(f.plan);
  expect(hosts("Substitutes")).toHaveLength(0);
  expect(db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()?.n).toBe(0);
});
it("offers source selection or manual preparation for an empty week and falls back to Journal on direct entry", async () => {
  const { preparation } = await setup(false);
  await render();
  expect(hosts("Empty")).toHaveLength(1);
  await act(() => button("Choisir mon pense-bête").props.onPress());
  expect(env.push).toHaveBeenLastCalledWith({
    pathname: "/commercial-documents",
    params: { weekStart: preparation.weekStart },
  });
  env.canGoBack = false;
  await act(() => button("Retour").props.onPress());
  expect(env.replace).toHaveBeenCalledWith("/(tabs)/today");
});
