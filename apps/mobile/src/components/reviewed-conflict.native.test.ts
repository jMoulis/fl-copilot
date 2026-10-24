import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeStoreConflictFixture } from "../../../../scripts/test-store-conflict-fixtures";
import { applyStoreContext } from "../store/context-repository";
import { StoreContextConflict } from "../store/context-conflict";
import { StoreEventConflict } from "../needs/store-event-conflict";
import { applyStoreProductEvent } from "../needs/store-event-repository";
type Kind = "SETTINGS" | "FIELD_EVENT";
const component = (kind: Kind) =>
  kind === "SETTINGS" ? StoreContextConflict : StoreEventConflict;
const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  focused: true,
  back: vi.fn(),
  sync: vi.fn(),
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
  SectionCard: "Card",
  SecondaryButton: "Button",
  InlineAlert: "Alert",
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
    digestStringAsync: async (_algorithm: string, text: string) => {
      if (runtime.hold) {
        const hold = runtime.hold;
        runtime.hold = undefined;
        hold.entered();
        await hold.promise;
      }
      return createHash("sha256").update(text).digest("hex");
    },
  };
});
let tree: ReactTestRenderer | undefined;
const fixtures: Array<Awaited<ReturnType<typeof nativeStoreConflictFixture>>> =
  [];
async function setup(kind: Kind) {
  const s = await nativeStoreConflictFixture(kind);
  fixtures.push(s);
  runtime.database = { sqlite: s.a, deviceId: s.scope.deviceId };
  runtime.session = {
    user: { id: s.scope.ownerId },
    stores: [{ storeId: s.scope.storeId }],
  };
  await act(async () => {
    tree = create(
      createElement(component(kind), { conflict: s.review.conflict }),
    );
  });
  return s;
}
function hosts(tag: string) {
  return tree!.root.findAll(
    (node) => typeof node.type === "string" && node.type === tag,
  );
}
function host(tag: string) {
  return hosts(tag)[0]!;
}
function button(label: string) {
  return hosts("Button").find((n) => n.props.label === label)!;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.focused = true;
  runtime.hold = undefined;
  runtime.sync.mockReset().mockResolvedValue(undefined);
  runtime.back.mockClear();
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
  runtime.hold = undefined;
});
describe.each(["SETTINGS", "FIELD_EVENT"] as const)(
  "%s native comparison",
  (kind) => {
    const table =
        kind === "SETTINGS" ? "store_context_settings" : "store_product_events",
      historyTable =
        kind === "SETTINGS"
          ? "store_context_history"
          : "store_product_event_history",
      keepLabel =
        kind === "SETTINGS"
          ? "Conserver mes réglages locaux"
          : "Confirmer mon heure de fin",
      adoptLabel =
        kind === "SETTINGS"
          ? "Adopter les réglages synchronisés"
          : "Adopter la version synchronisée";
    const pull =
      kind === "SETTINGS" ? applyStoreContext : applyStoreProductEvent;
    it("requires a comparison and accepts a double press only once through the real SQLite writer", async () => {
      const s = await setup(kind),
        before = s.count(historyTable);
      expect(button(keepLabel).props.disabled).toBe(true);
      await act(async () => host("Switch").props.onValueChange(true));
      const action = button(keepLabel);
      expect(action.props.disabled).toBe(false);
      await act(async () => {
        action.props.onPress();
        action.props.onPress();
      });
      expect(s.count(historyTable)).toBe(before + 1);
      expect(runtime.back).toHaveBeenCalledTimes(1);
      expect(runtime.sync).toHaveBeenCalledTimes(1);
    });
    it("shows a targeted stale error, clears consent and requires rereading before another choice", async () => {
      const s = await setup(kind);
      await act(async () => host("Switch").props.onValueChange(true));
      await pull(s.a, s.scope.storeId, {
        ...s.review.remote,
        version: 3,
      });
      await act(async () => button(adoptLabel).props.onPress());
      expect(
        hosts("Alert").some((n) =>
          /comparaison.*changé/.test(String(n.props.message)),
        ),
      ).toBe(true);
      expect(host("Switch").props.value).toBe(false);
      expect(button(adoptLabel).props.disabled).toBe(true);
      await act(async () => button("Relire la comparaison").props.onPress());
      expect(host("Switch").props.value).toBe(false);
      await act(async () => host("Switch").props.onValueChange(true));
      await act(async () => button(adoptLabel).props.onPress());
      expect(
        s.db.prepare(`SELECT remote_version FROM ${table}`).get()!
          .remote_version,
      ).toBe(3);
      expect(runtime.back).toHaveBeenCalledTimes(1);
    });
    it.each([
      "OWNER",
      "STORE",
      "DATABASE",
      "DEVICE",
      "BLUR",
      "UNMOUNT",
    ] as const)(
      "cancels a delayed decision when its native context changes (%s)",
      async (mode) => {
        const s = await setup(kind),
          before = [table, "sync_conflicts", "sync_outbox", historyTable].map(
            (t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          );
        await act(async () => host("Switch").props.onValueChange(true));
        const entered = deferred(),
          release = deferred();
        runtime.hold = { entered: entered.resolve, promise: release.promise };
        await act(async () => {
          button(keepLabel).props.onPress();
          await entered.promise;
        });
        await act(async () => {
          if (mode === "OWNER")
            runtime.session = {
              user: { id: "another-owner" },
              stores: [{ storeId: s.scope.storeId }],
            };
          if (mode === "STORE")
            runtime.session = {
              user: { id: s.scope.ownerId },
              stores: [{ storeId: "another-store" }],
            };
          if (mode === "DATABASE") {
            const other = await nativeStoreConflictFixture(kind);
            fixtures.push(other);
            runtime.database = { sqlite: other.a, deviceId: s.scope.deviceId };
          }
          if (mode === "DEVICE")
            runtime.database = { sqlite: s.a, deviceId: "another-device" };
          if (mode === "BLUR") runtime.focused = false;
          if (mode === "UNMOUNT") {
            tree!.unmount();
            tree = undefined;
          } else
            tree!.update(
              createElement(component(kind), { conflict: s.review.conflict }),
            );
        });
        await act(async () => {
          release.resolve();
          await release.promise;
        });
        expect(
          [table, "sync_conflicts", "sync_outbox", historyTable].map((t) =>
            s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          ),
        ).toEqual(before);
        expect(runtime.sync).not.toHaveBeenCalled();
        expect(runtime.back).not.toHaveBeenCalled();
      },
    );
    it("keeps the readable local data after a failed reread and retries without accepting a stale comparison", async () => {
      const s = await setup(kind),
        before = s.count(historyTable);
      vi.spyOn(s.a, "getFirstAsync").mockRejectedValueOnce(
        Error("TEMPORARY_READ"),
      );
      await act(async () => button("Relire la comparaison").props.onPress());
      expect(
        hosts("Text").some((n) =>
          String(n.props.children).includes(
            kind === "SETTINGS" ? "Asnières" : "Rupture",
          ),
        ),
      ).toBe(true);
      expect(button(keepLabel).props.disabled).toBe(true);
      expect(
        hosts("Alert").some((n) =>
          String(n.props.message).includes("ne peut pas être relue"),
        ),
      ).toBe(true);
      await act(async () => button("Relire la comparaison").props.onPress());
      expect(host("Switch").props.value).toBe(false);
      expect(host("Switch").props.disabled).toBe(false);
      expect(s.count(historyTable)).toBe(before);
      expect(runtime.sync).not.toHaveBeenCalled();
    });
    it("rejects an old rendered button callback after replacing the operational SQLite connection", async () => {
      const s = await setup(kind);
      await act(async () => host("Switch").props.onValueChange(true));
      const oldAction = button(keepLabel).props.onPress,
        before = [table, "sync_outbox", historyTable, "sync_conflicts"].map(
          (t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        );
      const other = await nativeStoreConflictFixture(kind);
      fixtures.push(other);
      runtime.database = { sqlite: other.a, deviceId: s.scope.deviceId };
      await act(async () =>
        tree!.update(
          createElement(component(kind), { conflict: s.review.conflict }),
        ),
      );
      await act(async () => oldAction());
      expect(
        [table, "sync_outbox", historyTable, "sync_conflicts"].map((t) =>
          s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        ),
      ).toEqual(before);
      expect(runtime.sync).not.toHaveBeenCalled();
      expect(runtime.back).not.toHaveBeenCalled();
    });
    it("preserves a committed local choice when the subsequent synchronization fails", async () => {
      const s = await setup(kind),
        before = s.count(historyTable);
      runtime.sync.mockRejectedValueOnce(Error("OFFLINE"));
      await act(async () => host("Switch").props.onValueChange(true));
      await act(async () => button(keepLabel).props.onPress());
      expect(s.count(historyTable)).toBe(before + 1);
      expect(
        s.db
          .prepare(`SELECT sync_state FROM ${table} WHERE store_id=?`)
          .get(s.scope.storeId)!.sync_state,
      ).toBe("PENDING");
      expect(hosts("Alert")).toHaveLength(0);
      expect(runtime.back).toHaveBeenCalledTimes(1);
    });
  },
);
