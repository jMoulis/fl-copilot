import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { it, expect, vi } from "vitest";
import { SyncRecoveryPanel } from "./recovery-panel";
const runtime = vi.hoisted(() => ({
  session: {
    user: { id: "00000000-0000-4000-8000-000000000001" },
    stores: [
      { storeId: "00000000-0000-4000-8000-000000000002", role: "MANAGER" },
    ],
  },
  sqlite: {},
  retry: vi.fn(async (...args: unknown[]) => {
    void args;
    return 1;
  }),
  retire: vi.fn(async (...args: unknown[]) => {
    void args;
  }),
  sync: vi.fn(async () => {}),
  list: vi.fn(),
}));
vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.sqlite }),
}));
vi.mock("./sync-provider", () => ({
  useSync: () => ({
    syncNow: runtime.sync,
    status: "error",
    lastSyncedAt: "one",
    failedCount: 2,
    pendingDetails: [{ retryAction: "ANALYTICS_RECOMPUTE" }],
  }),
}));
vi.mock("../analytics/local-recomputation", () => ({
  retryFailedAnalyticsJobs: (...args: unknown[]) => runtime.retry(...args),
}));
vi.mock("../intake/email-decision-repository", () => ({
  retireDeletedConversationEmailDecision: (...args: unknown[]) =>
    runtime.retire(...args),
}));
vi.mock("./outbox-repository", () => ({
  OutboxRepository: class {
    listFailures(...args: unknown[]) {
      return runtime.list(...args);
    }
  },
}));
vi.mock("../documents/source-upload-recovery-panel", () => ({
  SourceUploadRecoveryPanel: () => null,
}));
vi.mock("../components/ui", () => ({
  InlineAlert: "Alert",
  SecondaryButton: "Button",
  SectionCard: "Card",
}));
it("offers separate recovery actions, prevents a double tap and rejects retained callbacks after account change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const priorError = console.error;
  const silence = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      if (!String(args[0]).includes("react-test-renderer is deprecated"))
        priorError(...args);
    });
  let tree: ReactTestRenderer | undefined;
  const original = runtime.session;
  runtime.list.mockResolvedValue({
    items: [
      {
        commandId: "old",
        entityType: "email_intake_decision",
        entityId: "old-entity",
        localSequence: 1,
        code: "COPILOT_HISTORY_ACCESS_INVALID",
        conversationId: "00000000-0000-4000-8000-000000000003",
        parentDeleted: true,
      },
    ],
    hasMore: false,
  });
  try {
    await act(async () => {
      tree = create(createElement(SyncRecoveryPanel));
    });
    const button = (label: string) =>
      tree!.root.findAll(
        (n) => String(n.type) === "Button" && n.props.label === label,
      )[0];
    const retry = button("Reprendre les calculs en échec").props.onPress;
    await act(async () => {
      retry();
      retry();
    });
    expect(runtime.retry).toHaveBeenCalledTimes(1);
    expect(runtime.sync).toHaveBeenCalledTimes(1);
    const retire = button("Écarter cet ancien envoi").props.onPress;
    await act(async () => {
      retire();
    });
    expect(runtime.retire).toHaveBeenCalledTimes(1);
    expect(runtime.retire.mock.calls[0]?.[1]).toEqual({
      ownerId: original.user.id,
      storeId: original.stores[0].storeId,
    });
    runtime.session = {
      ...original,
      user: { id: "00000000-0000-4000-8000-000000000004" },
    };
    await act(async () => {
      tree!.update(createElement(SyncRecoveryPanel));
    });
    await act(async () => {
      retry();
      retire();
    });
    expect(runtime.retry).toHaveBeenCalledTimes(1);
    expect(runtime.retire).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => tree?.unmount());
    runtime.session = original;
    silence.mockRestore();
    vi.unstubAllGlobals();
  }
});
