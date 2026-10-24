import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { copilotTranscriptionFixture } from "../../../../scripts/test-copilot-transcription-fixtures";
import { CopilotTranscriptionReviewController } from "./transcription-review-controller";
import { receiptReviewDigest } from "../../../../scripts/test-receipt-publication-sqlite";
import { TranscriptionReviewCard } from "./transcription-review-card";
const runtime = vi.hoisted(() => ({
  focused: true,
  saved: vi.fn(),
  database: undefined as unknown,
  session: undefined as unknown,
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Switch: "Switch",
  Pressable: "Pressable",
  ActivityIndicator: "ActivityIndicator",
}));
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({ syncNow: vi.fn() }),
}));
vi.mock("@/components/ui", () => ({
  SectionCard: "Card",
  InlineAlert: "Alert",
  SecondaryButton: "Button",
}));
vi.mock("../commercial/original-button", () => ({
  CommercialOriginalButton: "OriginalButton",
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn() },
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focus = runtime.focused;
    useEffect(() => (focus ? cb() : undefined), [cb, focus]);
  },
}));
vi.mock("expo-crypto", async () => {
  const { createHash, randomUUID } = await import("node:crypto");
  return {
    randomUUID,
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digestStringAsync: async (_a: string, s: string) =>
      createHash("sha256").update(s).digest("hex"),
  };
});
type F = Awaited<ReturnType<typeof copilotTranscriptionFixture>>;
const fixtures: F[] = [];
let tree: ReactTestRenderer | undefined;
const hosts = (tag: string) =>
  tree!.root.findAll(
    (n) => typeof n.type === "string" && String(n.type) === tag,
  );
const button = () =>
  hosts("Pressable").find(
    (n) =>
      n.props.accessibilityLabel ===
      "Conserver le choix synchronisé depuis le chat",
  )!;
const checkbox = () => hosts("Switch")[0]!;
const view = (s: F, controller = s.controller, canConfirm = true) =>
  createElement(TranscriptionReviewCard, {
    message: s.message,
    controller,
    canConfirm,
    onSaved: runtime.saved,
  });
async function setup() {
  const s = await copilotTranscriptionFixture();
  fixtures.push(s);
  runtime.session = {
    user: { id: s.scope.ownerId },
    stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
  };
  runtime.database = { sqlite: s.dbAdapter, deviceId: s.scope.deviceId };
  return s;
}
const snapshot = (s: F) =>
  [
    "source_documents",
    "commercial_review_pages",
    "commercial_review_decisions",
    "sync_outbox",
    "sync_conflicts",
    "copilot_tool_results",
  ].map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.saved.mockReset();
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  for (const s of fixtures.splice(0)) s.db.close();
  vi.restoreAllMocks();
});
it("renders the canonical source/two intentions and commits a compared double press only once", async () => {
  const s = await setup();
  await act(async () => {
    tree = create(view(s));
  });
  expect(hosts("OriginalButton")[0]!.props.sourceDocumentId).toBe(
    s.page.sourceDocumentId,
  );
  expect(button().props.disabled).toBe(true);
  await act(async () => {
    checkbox().props.onValueChange(true);
  });
  expect(button().props.disabled).toBe(false);
  const press = button().props.onPress;
  await act(async () => {
    press();
    press();
  });
  expect(runtime.saved).toHaveBeenCalledTimes(1);
  expect(
    s.db.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get(),
  ).toEqual({ n: 1 });
  expect(
    s.db
      .prepare("SELECT sync_state FROM commercial_review_decisions WHERE id=?")
      .get(s.local.id),
  ).toEqual({ sync_state: "SUPERSEDED" });
});
it("an old comparison checkbox cannot approve a different committed document", async () => {
  const a = await setup();
  await act(async () => {
    tree = create(view(a));
  });
  const oldCheck = checkbox().props.onValueChange,
    oldPress = button().props.onPress;
  const b = await setup();
  await act(async () => {
    tree!.update(view(b));
  });
  expect(hosts("OriginalButton")[0]!.props.sourceDocumentId).toBe(
    b.page.sourceDocumentId,
  );
  expect(checkbox().props.value).toBe(false);
  const beforeA = snapshot(a),
    beforeB = snapshot(b);
  await act(async () => {
    oldCheck(true);
    oldPress();
  });
  expect(checkbox().props.value).toBe(false);
  expect(button().props.disabled).toBe(true);
  expect(snapshot(a)).toEqual(beforeA);
  expect(snapshot(b)).toEqual(beforeB);
});
it("revoked rights reject retained confirmation and require comparison again after restoration", async () => {
  const s = await setup();
  await act(async () => {
    tree = create(view(s));
  });
  await act(async () => {
    checkbox().props.onValueChange(true);
  });
  const old = button().props.onPress,
    before = snapshot(s),
    blocked = new CopilotTranscriptionReviewController(
      s.dbAdapter,
      { ...s.scope, canReviewTranscriptions: false },
      receiptReviewDigest,
    );
  await act(async () => {
    tree!.update(view(s, blocked, false));
  });
  await act(async () => {
    old();
  });
  expect(snapshot(s)).toEqual(before);
  expect(button().props.disabled).toBe(true);
  await act(async () => {
    tree!.update(view(s));
  });
  expect(checkbox().props.value).toBe(false);
  expect(button().props.disabled).toBe(true);
});
it("a reread invalidates both an old checkbox and old confirmation callback", async () => {
  const s = await setup();
  await act(async () => {
    tree = create(view(s));
  });
  const oldCheck = checkbox().props.onValueChange;
  await act(async () => {
    oldCheck(true);
  });
  const old = button().props.onPress,
    before = snapshot(s);
  const reload = hosts("Pressable").find(
    (n) =>
      n.findAll(
        (x) =>
          typeof x.type === "string" &&
          String(x.type) === "Text" &&
          x.props.children === "Relire les comparaisons",
      ).length,
  )!;
  await act(async () => {
    reload.props.onPress();
  });
  await act(async () => {
    oldCheck(true);
    old();
  });
  expect(checkbox().props.value).toBe(false);
  expect(button().props.disabled).toBe(true);
  expect(snapshot(s)).toEqual(before);
});
