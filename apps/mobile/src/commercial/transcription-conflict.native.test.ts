import { randomUUID } from "node:crypto";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { nativeCommercialTranscriptionFixture } from "../../../../scripts/test-commercial-transcription-fixtures";
import { CommercialTranscriptionConflict } from "./transcription-conflict";
import { OutboxRepository } from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  focused: true,
  sync: vi.fn(),
  back: vi.fn(),
  hold: undefined as
    undefined | { entered: () => void; promise: Promise<void> },
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
vi.mock("@/components/ui", () => ({
  InlineAlert: "Alert",
  SectionCard: "Card",
  SecondaryButton: "Button",
}));
vi.mock("./original-button", () => ({
  CommercialOriginalButton: "OriginalButton",
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Switch: "Switch",
}));
vi.mock("expo-router", () => ({
  router: { back: runtime.back },
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
    digestStringAsync: async (_algorithm: string, value: string) => {
      if (runtime.hold) {
        const hold = runtime.hold;
        runtime.hold = undefined;
        hold.entered();
        await hold.promise;
      }
      return createHash("sha256").update(value).digest("hex");
    },
  };
});
type Fixture = Awaited<ReturnType<typeof nativeCommercialTranscriptionFixture>>;
let tree: ReactTestRenderer | undefined;
const fixtures: Fixture[] = [];
const hosts = (tag: string) =>
  tree!.root.findAll(
    (n) => typeof n.type === "string" && String(n.type) === tag,
  );
const button = (label: string) =>
  hosts("Button").find((n) => n.props.label === label)!;
const label = "Conserver le choix synchronisé";
function view(s: Fixture, localId = s.local.id, onResolved?: () => void) {
  return createElement(CommercialTranscriptionConflict, {
    storeId: s.scope.storeId,
    localId,
    onResolved,
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup() {
  const s = await nativeCommercialTranscriptionFixture();
  fixtures.push(s);
  runtime.session = {
    user: { id: s.scope.ownerId },
    stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
  };
  runtime.database = { sqlite: s.a, deviceId: s.scope.deviceId };
  await act(async () => {
    tree = create(view(s));
  });
  return s;
}
const snapshot = (s: Fixture) =>
  [
    "commercial_review_pages",
    "commercial_review_decisions",
    "sync_conflicts",
    "sync_outbox",
  ].map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.hold = undefined;
  runtime.sync.mockReset().mockResolvedValue(undefined);
  runtime.back.mockReset();
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
it("shows source and both immutable intentions, requires comparison, and accepts double press once", async () => {
  const s = await setup();
  expect(hosts("OriginalButton")[0]!.props.sourceDocumentId).toBe(
    s.page.sourceDocumentId,
  );
  expect(button(label).props.disabled).toBe(true);
  expect(
    hosts("Text").some((n) => String(n.props.children).includes("3,49 €/kg")),
  ).toBe(true);
  await act(async () => hosts("Switch")[0]!.props.onValueChange(true));
  const action = button(label).props.onPress;
  await act(async () => {
    action();
    action();
  });
  expect(
    s.db
      .prepare(
        "SELECT COUNT(*) n FROM sync_conflicts WHERE conflict_type='COMMERCIAL_TRANSCRIPTION_REVIEW_CAPTURE'",
      )
      .get()!.n,
  ).toBe(1);
  expect(
    (await new OutboxRepository(s.a).getById(s.command.commandId))!.status,
  ).toBe("FAILED");
  expect(runtime.sync).toHaveBeenCalledTimes(1);
  expect(runtime.back).toHaveBeenCalledTimes(1);
});
it("clears consent and rereads the complete current group after a newer conflict", async () => {
  const s = await setup();
  await act(async () => hosts("Switch")[0]!.props.onValueChange(true));
  const outbox = new OutboxRepository(s.a),
    command = await outbox.enqueue({ ...s.command, commandId: randomUUID() });
  await outbox.markSyncing(command.commandId);
  await outbox.markConflict(
    command.commandId,
    "COMMERCIAL_REVIEW_ALREADY_RECORDED",
  );
  await new ConflictRepository(s.a).recordPushConflict(command, {
    commandId: command.commandId,
    entityType: command.entityType,
    entityId: command.entityId,
    status: "CONFLICT",
    remoteEntity: s.envelope,
    remoteVersion: 1,
  });
  await act(async () => button(label).props.onPress());
  expect(
    hosts("Alert").some((n) =>
      String(n.props.message).includes("comparaison a changé"),
    ),
  ).toBe(true);
  expect(hosts("Switch")[0]!.props.value).toBe(false);
  expect(button(label).props.disabled).toBe(true);
  await act(async () => button("Relire la comparaison").props.onPress());
  await act(async () => hosts("Switch")[0]!.props.onValueChange(true));
  await act(async () => button(label).props.onPress());
  expect(await new ConflictRepository(s.a).listOpen(s.scope.storeId)).toEqual(
    [],
  );
});
it.each([
  "OWNER",
  "STORE",
  "DATABASE",
  "DEVICE",
  "ROLE",
  "TARGET",
  "BLUR",
  "UNMOUNT",
] as const)(
  "cancels a delayed adoption when native context changes (%s)",
  async (mode) => {
    const s = await setup(),
      before = snapshot(s),
      entered = deferred(),
      gate = deferred();
    await act(async () => hosts("Switch")[0]!.props.onValueChange(true));
    runtime.hold = { entered: entered.resolve, promise: gate.promise };
    await act(async () => {
      button(label).props.onPress();
      await entered.promise;
    });
    await act(async () => {
      if (mode === "OWNER")
        runtime.session = {
          user: { id: randomUUID() },
          stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
        };
      if (mode === "STORE")
        runtime.session = {
          user: { id: s.scope.ownerId },
          stores: [{ storeId: randomUUID(), role: "MANAGER" }],
        };
      if (mode === "ROLE")
        runtime.session = {
          user: { id: s.scope.ownerId },
          stores: [{ storeId: s.scope.storeId, role: "VIEWER" }],
        };
      if (mode === "DEVICE")
        runtime.database = { sqlite: s.a, deviceId: randomUUID() };
      if (mode === "DATABASE") {
        const other = await nativeCommercialTranscriptionFixture();
        fixtures.push(other);
        runtime.database = { sqlite: other.a, deviceId: s.scope.deviceId };
      }
      if (mode === "BLUR") runtime.focused = false;
      if (mode === "UNMOUNT") {
        tree!.unmount();
        tree = undefined;
      } else
        tree!.update(view(s, mode === "TARGET" ? randomUUID() : s.local.id));
    });
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(snapshot(s)).toEqual(before);
    expect(runtime.sync).not.toHaveBeenCalled();
    expect(runtime.back).not.toHaveBeenCalled();
  },
);
it("keeps visible intentions after a failed reread and rejects a stale consent", async () => {
  const s = await setup();
  vi.spyOn(s.a, "getFirstAsync").mockRejectedValueOnce(Error("TEMP_READ"));
  await act(async () => button("Relire la comparaison").props.onPress());
  expect(hosts("Card").map((n) => n.props.title)).toContain(
    "Votre transcription locale",
  );
  expect(button(label).props.disabled).toBe(true);
  await act(async () => button("Relire la comparaison").props.onPress());
  expect(hosts("Switch")[0]!.props.value).toBe(false);
  expect(hosts("Switch")[0]!.props.disabled).toBe(false);
});
it.each(["SEND", "PARENT"] as const)(
  "does not report a failed adoption after committed choice when %s fails",
  async (mode) => {
    const s = await setup();
    if (mode === "SEND") runtime.sync.mockRejectedValueOnce(Error("OFFLINE"));
    else
      await act(async () =>
        tree!.update(
          view(s, s.local.id, () => {
            throw Error("PARENT_READ");
          }),
        ),
      );
    await act(async () => hosts("Switch")[0]!.props.onValueChange(true));
    await act(async () => button(label).props.onPress());
    expect(hosts("Alert").map((n) => n.props.title)).toEqual([
      "Comparaison enregistrée",
    ]);
    expect(await s.repository.decisions(s.scope.storeId)).toEqual([
      { decision: s.remote, state: "SYNCED" },
    ]);
  },
);

it("rejects a retained comparison checkbox after another source is committed", async () => {
  const a = await setup(),
    oldCheck = hosts("Switch")[0]!.props.onValueChange;
  const b = await nativeCommercialTranscriptionFixture();
  fixtures.push(b);
  runtime.session = {
    user: { id: b.scope.ownerId },
    stores: [{ storeId: b.scope.storeId, role: "MANAGER" }],
  };
  runtime.database = { sqlite: b.a, deviceId: b.scope.deviceId };
  await act(async () => {
    tree!.update(view(b));
  });
  const beforeA = snapshot(a),
    beforeB = snapshot(b);
  await act(async () => {
    oldCheck(true);
  });
  expect(hosts("Switch")[0]!.props.value).toBe(false);
  expect(button(label).props.disabled).toBe(true);
  expect(snapshot(a)).toEqual(beforeA);
  expect(snapshot(b)).toEqual(beforeB);
});
