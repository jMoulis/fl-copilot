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
  placementId: undefined as string | undefined,
  draft: undefined as string | undefined,
  mode: undefined as string | undefined,
  taskId: undefined as string | undefined,
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
  useLocalSearchParams: () => ({
    weekStart: env.weekStart,
    placementId: env.placementId,
    draft: env.draft,
    mode: env.mode,
    taskId: env.taskId,
  }),
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
  AppScreen: ({
    header,
    children,
  }: {
    header?: ReactNode;
    children: ReactNode;
  }) => createElement("Screen", null, header, children),
  AppHeader: "Header",
  SectionCard: "Card",
  SecondaryButton: "Button",
  PrimaryButton: "Button",
  InlineAlert: "Alert",
  EmptyState: "Empty",
}));
vi.mock("@/components/dashboard", () => ({
  IconButton: "IconButton",
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
vi.mock("@/design/tokens", () => import("../design/tokens"));
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
  CommercialExecutionView: (props: {
    renderDetail?(content: ReactNode, action: ReactNode): ReactNode;
  }) => createElement("Execution", props, props.renderDetail?.(null, null)),
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
const back = () => hosts("IconButton")[0]!;
const disclosure = (title: string) =>
  hosts("Disclosure").find((n) => n.props.title === title)!;
const outboxCount = () =>
  db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()?.n;
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
  env.placementId = undefined;
  env.draft = undefined;
  env.mode = undefined;
  env.taskId = undefined;
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
  const cards = hosts("TgPresentation")[0]!;
  expect(cards.props.layout).toBe("cards");
  expect(cards.props.placements).toEqual(preparation.placements);
  await act(() => cards.props.onOpenPlacement(preparation.placements[0]!.id));
  expect(env.push).toHaveBeenLastCalledWith({
    pathname: "/commercial-plan",
    params: {
      weekStart: preparation.weekStart,
      placementId: preparation.placements[0]!.id,
      draft: "1",
    },
  });
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
  expect(outboxCount()).toBe(0);
  await act(() => back().props.onPress());
  expect(env.back).toHaveBeenCalledOnce();
  expect(env.replace).not.toHaveBeenCalled();
});
it("refreshes after returning from chat and keeps current execution separate from a newer draft and archived views", async () => {
  const { f, sqlite, preparation } = await setup(false);
  await applyCommercialPlan(sqlite, f.storeId, f.plan);
  await render();
  expect(hosts("Execution")[0]!.props.plan).toEqual(f.plan);
  expect(hosts("Execution")[0]!.props.presentation).toBe("week");
  env.focused = false;
  await render();
  const newer = { ...preparation, version: f.plan.preparation.version + 1 };
  await applyCommercialPreparation(sqlite, f.storeId, newer);
  env.focused = true;
  await render();
  expect(hosts("TgPresentation")[0]!.props.placements).toEqual(
    newer.placements,
  );
  expect(hosts("Execution")).toHaveLength(0);
  await act(() => disclosure("Suivre le plan déjà confirmé").props.onPress());
  expect(hosts("Execution")[0]!.props.plan).toEqual(f.plan);
  expect(hosts("Execution")[0]!.props.presentation).toBe("week");
  expect(hosts("Substitutes")).toHaveLength(0);
  await act(() => disclosure("Voir les choix déjà confirmés").props.onPress());
  expect(hosts("PlanContent")[0]!.props.plan).toEqual(f.plan);
  expect(outboxCount()).toBe(0);
});
it("opens a draft TG as read-only detail and returns to the same week without recording an installation", async () => {
  const { preparation } = await setup();
  env.placementId = preparation.placements[0]!.id;
  env.draft = "1";
  await render();
  expect(hosts("TgPresentation")[0]!.props).toMatchObject({
    layout: "detail",
    placements: [preparation.placements[0]],
  });
  expect(hosts("Execution")).toHaveLength(0);
  expect(hosts("Review")).toHaveLength(0);
  expect(outboxCount()).toBe(0);
  await act(() => back().props.onPress());
  expect(env.back).toHaveBeenCalledOnce();
  env.canGoBack = false;
  await act(() => back().props.onPress());
  expect(env.replace).toHaveBeenCalledWith({
    pathname: "/commercial-plan",
    params: { weekStart: preparation.weekStart },
  });
  expect(outboxCount()).toBe(0);
});
it("reports a removed draft TG without falling through to a different placement or an execution editor", async () => {
  await setup();
  env.placementId = "removed-placement";
  env.draft = "1";
  await render();
  expect(hosts("Alert")[0]!.props.title).toBe("TG introuvable");
  expect(hosts("TgPresentation")).toHaveLength(0);
  expect(hosts("Execution")).toHaveLength(0);
  expect(outboxCount()).toBe(0);
});
it("keeps an expired draft link read-only even when the same placement exists in a confirmed plan", async () => {
  const { f, sqlite } = await setup(false);
  await applyCommercialPlan(sqlite, f.storeId, f.plan);
  env.placementId = f.plan.preparation.placements[0]!.id;
  env.draft = "1";
  await render();
  expect(
    hosts("Alert").some((node) => node.props.title === "TG introuvable"),
  ).toBe(true);
  expect(hosts("Execution")).toHaveLength(0);
  expect(hosts("TgPresentation")).toHaveLength(0);
  expect(hosts("Review")).toHaveLength(0);
  expect(outboxCount()).toBe(0);
});
it("opens a confirmed TG from its week and delegates only the exact placement to the existing execution controller", async () => {
  const { f, sqlite } = await setup(false);
  await applyCommercialPlan(sqlite, f.storeId, f.plan);
  await render();
  const execution = hosts("Execution")[0]!;
  expect(execution.props.presentation).toBe("week");
  const placementId = f.plan.preparation.placements[0]!.id;
  await act(() => execution.props.onOpenPlacement(placementId));
  expect(env.push).toHaveBeenLastCalledWith({
    pathname: "/commercial-plan",
    params: { weekStart: f.plan.weekStart, placementId },
  });
  env.placementId = placementId;
  await render();
  expect(hosts("Execution")).toHaveLength(1);
  expect(hosts("Execution")[0]!.props).toMatchObject({
    plan: f.plan,
    presentation: "placement",
    placementId,
  });
  expect(hosts("PlanContent")).toHaveLength(0);
  await act(() => back().props.onPress());
  expect(env.back).toHaveBeenCalledOnce();
  env.canGoBack = false;
  await act(() => back().props.onPress());
  expect(env.replace).toHaveBeenCalledWith({
    pathname: "/commercial-plan",
    params: { weekStart: f.plan.weekStart },
  });
  expect(outboxCount()).toBe(0);
});
it("keeps an invalid confirmed placement explicit for the controller rather than choosing a different TG", async () => {
  const { f, sqlite } = await setup(false);
  await applyCommercialPlan(sqlite, f.storeId, f.plan);
  env.placementId = "removed-placement";
  await render();
  expect(hosts("Execution")[0]!.props).toMatchObject({
    plan: f.plan,
    presentation: "placement",
    placementId: "removed-placement",
  });
  expect(outboxCount()).toBe(0);
});
it("preserves installation links from chat and explicit task links from Journal when a newer draft exists", async () => {
  const { f, sqlite, preparation } = await setup(false);
  await applyCommercialPlan(sqlite, f.storeId, f.plan);
  env.mode = "installation";
  await render();
  expect(hosts("Execution")[0]!.props).toMatchObject({
    plan: f.plan,
    presentation: "placement",
  });
  await applyCommercialPreparation(sqlite, f.storeId, {
    ...preparation,
    version: f.plan.preparation.version + 1,
  });
  env.mode = "execution";
  env.taskId = "requested-task";
  env.sync.lastSyncedAt = "newer-draft";
  await render();
  expect(hosts("Execution")).toHaveLength(1);
  expect(hosts("Execution")[0]!.props).toMatchObject({
    plan: f.plan,
    initialTaskId: "requested-task",
  });
  expect(outboxCount()).toBe(0);
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
  await act(() => back().props.onPress());
  expect(env.replace).toHaveBeenCalledWith("/(tabs)/today");
});
