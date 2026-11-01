import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CommercialReviewRepository } from "./review-repository";
import CommercialReviewScreen from "../app/(tabs)/commercial-review/[id]";
import { nativeCommercialTranscriptionFixture } from "../../../../scripts/test-commercial-transcription-fixtures";
const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  documentId: "",
  focused: true,
  status: "idle",
  sync: vi.fn(),
  alert: vi.fn(),
  capture: vi.fn(),
}));
vi.mock(
  "@/commercial/transcription-conflict",
  () => import("./transcription-conflict"),
);
vi.mock("@/commercial/review-repository", () => import("./review-repository"));
vi.mock(
  "@/commercial/review-presentation",
  () => import("./review-presentation"),
);
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({ syncNow: runtime.sync, status: runtime.status }),
}));
vi.mock("@/observability/sentry", () => ({
  captureScreenError: runtime.capture,
}));
vi.mock("@/commercial/visual-repository", () => ({
  readCommercialVisualReadings: async () => [],
}));
vi.mock("@/commercial/offer-choice-repository", () => ({
  readCommercialChoices: async () => [],
}));
vi.mock("@/commercial/visual-view", () => ({ CommercialVisualView: "Visual" }));
vi.mock("@/commercial/strategy-entry", () => ({
  CommercialStrategyEntry: "Strategy",
}));
vi.mock("@/commercial/summary-view", () => ({
  CommercialSummaryView: "Summary",
}));
vi.mock("@/commercial/original-button", () => ({
  CommercialOriginalButton: "Original",
}));
vi.mock("./original-button", () => ({ CommercialOriginalButton: "Original" }));
vi.mock("@/components/ui", () => ({
  AppScreen: "Screen",
  AppHeader: "Header",
  SectionCard: "Card",
  InlineAlert: "InlineAlert",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  EmptyState: "Empty",
  BottomSheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: unknown;
  }) => (visible ? createElement("Sheet", null, children as never) : null),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  TextInput: "Input",
  Switch: "Switch",
  Alert: { alert: runtime.alert },
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn(), replace: vi.fn(), push: vi.fn() },
  useLocalSearchParams: () => ({ id: runtime.documentId }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focus = runtime.focused;
    useEffect(() => (focus ? cb() : undefined), [cb, focus]);
  },
}));
vi.mock("expo-crypto", async () => {
  const { randomUUID, createHash } = await import("node:crypto");
  return {
    randomUUID,
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash("sha256").update(value).digest("hex"),
  };
});
type Fixture = Awaited<ReturnType<typeof nativeCommercialTranscriptionFixture>>;
const fixtures: Fixture[] = [];
let tree: ReactTestRenderer | undefined;
const hosts = (tag: string) =>
  tree!.root.findAll(
    (n) => typeof n.type === "string" && String(n.type) === tag,
  );
const button = (label: string) =>
  hosts("Button").find((n) => n.props.label === label)!;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup(normal = false, showDetails = true) {
  const s = await nativeCommercialTranscriptionFixture(
    ":memory:",
    normal ? 0.99 : 0.8,
  );
  fixtures.push(s);
  // The ordinary-entry scenarios start with an unreviewed source in this disposable database.
  if (normal)
    for (const table of [
      "commercial_review_decisions",
      "sync_conflicts",
      "sync_outbox",
    ])
      await s.a.runAsync(`DELETE FROM ${table}`);
  runtime.session = {
    user: { id: s.scope.ownerId },
    stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
  };
  runtime.database = { sqlite: s.a, deviceId: s.scope.deviceId };
  runtime.documentId = s.page.sourceDocumentId;
  await act(async () => {
    tree = create(createElement(CommercialReviewScreen));
  });
  if (showDetails)
    await act(async () => hosts("Strategy")[0]!.props.onDetails());
  return s;
}
async function openItem(s: Fixture) {
  await act(async () => hosts("Summary")[0]!.props.onOpen(`${s.page.id}:0`));
}
function alertConfirmation() {
  return (
    runtime.alert.mock.calls.at(-1)![2] as Array<{
      text: string;
      onPress?: () => void;
    }>
  ).find((v) => v.text === "Confirmer")!.onPress!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.status = "idle";
  runtime.sync.mockReset().mockResolvedValue(undefined);
  runtime.alert.mockReset();
  runtime.capture.mockReset();
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      error(...args);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  for (const s of fixtures.splice(0)) s.db.close();
});
it("refreshes the real document after the conflict child unmounts, retaining the selected source", async () => {
  const s = await setup(),
    gate = deferred();
  runtime.sync.mockReturnValueOnce(gate.promise);
  await openItem(s);
  expect(hosts("Switch")).toHaveLength(1);
  await act(async () => hosts("Switch")[0]!.props.onValueChange(true));
  await act(async () =>
    button("Conserver le choix synchronisé").props.onPress(),
  );
  expect(hosts("Switch")).toHaveLength(0);
  expect(
    hosts("Original").every(
      (n) => n.props.sourceDocumentId === s.page.sourceDocumentId,
    ),
  ).toBe(true);
  expect(
    hosts("Text").some((n) => n.props.children === "Choix synchronisé"),
  ).toBe(true);
  await act(async () => {
    gate.resolve();
    await gate.promise;
  });
  expect(hosts("Switch")).toHaveLength(0);
  expect(await s.repository.decisions(s.scope.storeId)).toEqual([
    { decision: s.remote, state: "SYNCED" },
  ]);
});
it("retains a correction and selection across background sync, then saves locally while offline", async () => {
  const s = await setup(true);
  await openItem(s);
  await act(async () => button("Corriger la transcription").props.onPress());
  await act(async () => hosts("Input")[0]!.props.onChangeText("4,99 €/kg"));
  runtime.status = "syncing";
  await act(async () => tree!.update(createElement(CommercialReviewScreen)));
  runtime.status = "idle";
  await act(async () => tree!.update(createElement(CommercialReviewScreen)));
  expect(hosts("Input")[0]!.props.value).toBe("4,99 €/kg");
  runtime.sync.mockRejectedValueOnce(Error("OFFLINE"));
  await act(async () => button("Confirmer la transcription").props.onPress());
  await act(async () => alertConfirmation()());
  expect((await s.repository.decisions(s.scope.storeId))[0]).toMatchObject({
    decision: { corrections: [{ name: "sellingPrice", value: "4,99 €/kg" }] },
    state: "PENDING",
  });
  expect(
    hosts("InlineAlert").some((n) =>
      String(n.props.message).includes("n’a pas pu être enregistré"),
    ),
  ).toBe(false);
});
it.each(["OWNER", "ROLE", "BLUR"] as const)(
  "rejects an old native confirmation alert after %s change",
  async (mode) => {
    const s = await setup(true);
    await openItem(s);
    await act(async () => button("Confirmer la transcription").props.onPress());
    const old = alertConfirmation();
    await act(async () => {
      if (mode === "OWNER")
        runtime.session = {
          user: { id: crypto.randomUUID() },
          stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
        };
      if (mode === "ROLE")
        runtime.session = {
          user: { id: s.scope.ownerId },
          stores: [{ storeId: s.scope.storeId, role: "VIEWER" }],
        };
      if (mode === "BLUR") runtime.focused = false;
      tree!.update(createElement(CommercialReviewScreen));
    });
    await act(async () => old());
    expect(await s.repository.decisions(s.scope.storeId)).toEqual([]);
    expect(s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
    expect(runtime.sync).not.toHaveBeenCalled();
  },
);
it("does not claim a committed transcription failed when the following source read fails", async () => {
  const s = await setup(true);
  await openItem(s);
  const original = s.a.getAllAsync.bind(s.a);
  vi.spyOn(s.a, "getAllAsync").mockImplementation(async (sql, ...p) => {
    if (
      sql.includes("FROM commercial_review_pages") &&
      s.db.prepare("SELECT COUNT(*) n FROM commercial_review_decisions").get()!
        .n === 1
    )
      throw Error("POST_COMMIT_READ");
    return original(sql, ...p);
  });
  await act(async () => button("Confirmer la transcription").props.onPress());
  await act(async () => alertConfirmation()());
  expect(
    s.db.prepare("SELECT COUNT(*) n FROM commercial_review_decisions").get()!.n,
  ).toBe(1);
  expect(
    hosts("InlineAlert").some((n) =>
      String(n.props.message).includes("Le choix est enregistré"),
    ),
  ).toBe(true);
  expect(runtime.capture).not.toHaveBeenCalled();
});
it("confirms a readable group once through the same local transaction", async () => {
  const s = await setup(true);
  await act(async () => hosts("Summary")[0]!.props.onConfirmReadable());
  const confirm = (
    runtime.alert.mock.calls.at(-1)![2] as Array<{
      text: string;
      onPress?: () => void;
    }>
  ).find((v) => v.text === "Confirmer cette série")!.onPress!;
  await act(async () => {
    confirm();
    confirm();
  });
  expect(await s.repository.decisions(s.scope.storeId)).toHaveLength(1);
  expect(s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(1);
  expect(runtime.sync).toHaveBeenCalledTimes(1);
});
it("rejects a retained group confirmation from a closed native focus", async () => {
  const s = await setup(true);
  await act(async () => hosts("Summary")[0]!.props.onConfirmReadable());
  const confirm = (
    runtime.alert.mock.calls.at(-1)![2] as Array<{
      text: string;
      onPress?: () => void;
    }>
  ).find((v) => v.text === "Confirmer cette série")!.onPress!;
  runtime.focused = false;
  await act(async () => tree!.update(createElement(CommercialReviewScreen)));
  await act(async () => confirm());
  expect(await s.repository.decisions(s.scope.storeId)).toEqual([]);
  expect(s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
  expect(runtime.sync).not.toHaveBeenCalled();
});

it("opens on strategy without reading extraction pages or showing review controls, then loads details on request", async () => {
  const spy = vi.spyOn(CommercialReviewRepository.prototype, "pages");
  const s = await setup(true, false);
  expect(hosts("Strategy")[0]!.props.sourceDocumentId).toBe(
    s.page.sourceDocumentId,
  );
  expect(hosts("Summary")).toHaveLength(0);
  expect(spy).not.toHaveBeenCalled();
  expect(
    hosts("Button").some((n) => String(n.props.label).includes("Recommencer")),
  ).toBe(false);
  await act(async () => hosts("Strategy")[0]!.props.onDetails());
  expect(spy).toHaveBeenCalled();
  expect(hosts("Summary")).toHaveLength(1);
  spy.mockRestore();
});
