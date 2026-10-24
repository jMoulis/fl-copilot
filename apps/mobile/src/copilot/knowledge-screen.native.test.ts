import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import MemoryScreen from "../app/copilot-memory";
import { nativeKnowledgeConflictFixture } from "../../../../scripts/test-knowledge-conflict-fixtures";
import { OutboxRepository } from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { applyKnowledgeRecord } from "./knowledge-repository";
const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  focused: true,
  sync: vi.fn(),
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
vi.mock(
  "@/copilot/knowledge-repository",
  () => import("./knowledge-repository"),
);
vi.mock("@/copilot/knowledge-conflict", () => import("./knowledge-conflict"));
vi.mock("@/copilot/knowledge-suggestion", () => ({
  loadKnowledgeSuggestion: vi.fn(),
  confirmKnowledgeSuggestion: vi.fn(),
}));
vi.mock("@/design/tokens", () => import("../design/tokens"));
vi.mock("@/components/ui", () => ({
  AppScreen: "Screen",
  AppHeader: "Header",
  SectionCard: "Card",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  InlineAlert: "Alert",
}));
vi.mock("react-native", () => ({
  Text: "Text",
  TextInput: "Input",
  View: "View",
  Switch: "Switch",
  Alert: { alert: vi.fn() },
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn() },
  useLocalSearchParams: () => ({}),
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
    digestStringAsync: async (_a: string, text: string) =>
      createHash("sha256").update(text).digest("hex"),
  };
});
let tree: ReactTestRenderer | undefined;
const fixtures: Array<
  Awaited<ReturnType<typeof nativeKnowledgeConflictFixture>>
> = [];
function hosts(tag: string) {
  return tree!.root.findAll(
    (n) => typeof n.type === "string" && n.type === tag,
  );
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup() {
  const s = await nativeKnowledgeConflictFixture();
  fixtures.push(s);
  runtime.database = { sqlite: s.a, deviceId: s.scope.deviceId };
  runtime.session = {
    user: { id: s.scope.ownerId },
    stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
  };
  await act(async () => {
    tree = create(createElement(MemoryScreen));
  });
  return s;
}
async function choose() {
  await act(async () => hosts("Switch")[0]!.props.onValueChange(true));
  await act(async () =>
    hosts("Button")
      .find((n) => n.props.label === "Conserver ma version locale")!
      .props.onPress(),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.sync.mockReset().mockResolvedValue(undefined);
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
it("updates the real memory list immediately, then shows a subsequent server conflict after the comparison row unmounted", async () => {
  const s = await setup(),
    send = deferred();
  runtime.sync.mockReturnValueOnce(send.promise);
  await choose();
  expect(hosts("Switch")).toHaveLength(0);
  expect(JSON.stringify(tree!.toJSON())).toContain("À synchroniser");
  const packet = (
      await new OutboxRepository(s.a).listPending(s.scope.storeId)
    ).find((c) => c.entityType === "copilot_knowledge")!,
    remote = {
      ...s.review.remote,
      statement: "Nouvelle pratique distante",
      version: 4,
    };
  await new ConflictRepository(s.a).recordPushConflict(packet, {
    commandId: packet.commandId,
    status: "CONFLICT",
    entityType: packet.entityType,
    entityId: remote.id,
    remoteVersion: 4,
    remoteEntity: remote,
  });
  await applyKnowledgeRecord(s.a, s.review.scope, remote);
  await s.a.runAsync(
    "UPDATE copilot_knowledge SET sync_state='CONFLICT' WHERE id=?",
    remote.id,
  );
  await s.a.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    packet.commandId,
  );
  await act(async () => {
    send.resolve();
    await send.promise;
  });
  expect(hosts("Switch")).toHaveLength(1);
  expect(JSON.stringify(tree!.toJSON())).toContain(
    "Nouvelle pratique distante",
  );
  expect(
    (
      await new ConflictRepository(s.a).listOpenForEntity(
        s.scope.storeId,
        "copilot_knowledge",
        remote.id,
      )
    ).map((c) => c.id),
  ).toEqual([packet.commandId]);
  expect(runtime.sync).toHaveBeenCalledTimes(1);
});
it("does not report a failed save when only the post-commit list read fails", async () => {
  const s = await setup();
  await act(async () =>
    hosts("Input")[0]!.props.onChangeText("Pratique supplémentaire confirmée"),
  );
  vi.spyOn(s.a, "getAllAsync").mockRejectedValueOnce(Error("LIST_READ_FAILED"));
  await act(async () =>
    hosts("Button")
      .find((n) => n.props.label === "Confirmer et mémoriser")!
      .props.onPress(),
  );
  expect(
    s.db
      .prepare("SELECT COUNT(*) AS n FROM copilot_knowledge WHERE store_id=?")
      .get(s.scope.storeId)!.n,
  ).toBe(2);
  expect(JSON.stringify(tree!.toJSON())).toContain(
    "Pratique confirmée sur cet appareil",
  );
  expect(JSON.stringify(tree!.toJSON())).not.toContain(
    "Enregistrement impossible",
  );
});
it.each(["DATABASE", "OWNER", "BLUR"] as const)(
  "does not let a delayed post-sync list refresh cross its parent context (%s)",
  async (mode) => {
    const s = await setup(),
      send = deferred();
    runtime.sync.mockReturnValueOnce(send.promise);
    await choose();
    if (mode === "DATABASE") {
      const other = await nativeKnowledgeConflictFixture();
      fixtures.push(other);
      runtime.database = { sqlite: other.a, deviceId: s.scope.deviceId };
    }
    if (mode === "OWNER")
      runtime.session = {
        user: { id: randomUUID() },
        stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
      };
    if (mode === "BLUR") runtime.focused = false;
    await act(async () => tree!.update(createElement(MemoryScreen)));
    const reads = vi.spyOn(s.a, "getAllAsync");
    reads.mockClear();
    await act(async () => {
      send.resolve();
      await send.promise;
    });
    expect(reads).not.toHaveBeenCalled();
    expect(
      s.db
        .prepare("SELECT sync_state FROM copilot_knowledge WHERE id=?")
        .get(s.review.remote.id)!.sync_state,
    ).toBe("PENDING");
    if (mode !== "BLUR")
      expect(JSON.stringify(tree!.toJSON())).not.toContain("Pratique locale");
  },
);
