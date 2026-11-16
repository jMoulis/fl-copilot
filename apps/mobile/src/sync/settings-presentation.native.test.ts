import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SynchronizationScreen from "../app/(tabs)/sync";

const runtime = vi.hoisted(() => ({
  status: "pending",
  pendingCount: 18,
  pendingCommandCount: 1,
  conflictCount: 0,
  failedCount: 0,
  lastSyncedAt: "2026-11-16T09:38:00Z",
  syncNow: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: true,
}));
vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.mock("expo-router", () => ({
  router: {
    back: runtime.back,
    replace: runtime.replace,
    canGoBack: () => runtime.canGoBack,
  },
}));
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({
    session: { stores: [{ storeId: "store", name: "Magasin test" }] },
  }),
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({
    ...runtime,
    pendingDetails: [
      {
        label: "Calcul des indicateurs locaux",
        count: 17,
        state: "En attente",
        code: null,
      },
    ],
  }),
}));
vi.mock("@/sync/conflict-presentation", () => ({
  conflictEntityLabel: () => "Produit test",
}));
vi.mock("@/sync/use-sync-conflicts", () => ({
  useOpenSyncConflicts: () => [],
}));
vi.mock("@/documents/use-import-verification-conflicts", () => ({
  useOpenImportVerificationConflicts: () => [],
}));
vi.mock("@/components/ui", () => ({
  AppScreen: ({
    header,
    children,
  }: {
    header: ReactNode;
    children: ReactNode;
  }) => createElement("Screen", {}, header, children),
  InlineAlert: "Alert",
  PrimaryButton: "Action",
  SecondaryButton: "Action",
  SectionCard: "Card",
  StatusBadge: "Status",
}));
vi.mock("@/components/settings-chrome", () => ({
  SettingsHeader: "Header",
  SettingsIntro: "Intro",
}));
vi.mock("@/components/dashboard", () => ({ DetailsDisclosure: "Disclosure" }));
vi.mock("@/db/local-copies-panel", () => ({ LocalCopiesPanel: "Copies" }));
vi.mock("@/db/recovery-notice", () => ({
  LocalDatabaseRecoveryNotice: "RecoveryNotice",
}));
vi.mock("@/sync/recovery-panel", () => ({ SyncRecoveryPanel: "Recovery" }));
let tree: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.canGoBack = true;
  runtime.status = "pending";
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(() => tree.unmount());
  vi.unstubAllGlobals();
});
const mount = async () => {
  await act(() => {
    tree = create(createElement(SynchronizationScreen));
  });
};
it("distinguishes one outgoing change from seventeen local calculations and retains recovery actions", async () => {
  await mount();
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain('"children":["1"]');
  expect(json).toContain("Calcul des indicateurs locaux");
  expect(json).not.toContain('"children":["18"]');
  expect(tree.root.findAllByType("Recovery" as never)).toHaveLength(1);
  expect(tree.root.findByType("Disclosure" as never).props.title).toBe(
    "Copies locales et récupération",
  );
  await act(() => tree.root.findByType("Action" as never).props.onPress());
  expect(runtime.syncNow).toHaveBeenCalledExactlyOnceWith("store");
});
it("keeps a single Back action with an Imports fallback after isolated entry", async () => {
  await mount();
  const header = tree.root.findByType("Header" as never);
  await act(() => header.props.onBack());
  expect(runtime.back).toHaveBeenCalledOnce();
  runtime.canGoBack = false;
  await act(() => header.props.onBack());
  expect(runtime.replace).toHaveBeenCalledExactlyOnceWith("/(tabs)/actions");
});
it.each(["offline", "conflict", "error", "syncing"])(
  "preserves %s and its real notices",
  async (status) => {
    runtime.status = status;
    await mount();
    expect(tree.root.findByType("Status" as never).props.status).toBe(status);
    expect(tree.root.findByType("Action" as never).props.loading).toBe(
      status === "syncing",
    );
    if (status !== "syncing")
      expect(tree.root.findByType("Alert" as never).props.title).toBeTruthy();
  },
);
