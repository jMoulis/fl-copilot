import { ProductMasterRepository } from "./product-master-repository";
import { applyProductMasterChange } from "./apply-product-master";
import { OutboxRepository } from "../sync/outbox-repository";
import { randomUUID } from "node:crypto";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { nativeCatalogueConflictFixture } from "../../../../scripts/test-catalogue-conflict-fixtures";
import { ProductMasterConflict } from "./conflict";
const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  database: undefined as unknown,
  focused: true,
  sync: vi.fn(),
  back: vi.fn(),
  hold: undefined as
    undefined | { entered: () => void; promise: Promise<void> },
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ syncNow: runtime.sync }),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  Switch: "Switch",
  ActivityIndicator: "Spinner",
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
type Kind = "PRODUCT" | "IDENTIFIER" | "ALIAS";
type Fixture = Awaited<ReturnType<typeof nativeCatalogueConflictFixture>>;
let tree: ReactTestRenderer | undefined;
const fixtures: Fixture[] = [];
const hosts = (tag: string) =>
  tree!.root.findAll(
    (n) => typeof n.type === "string" && String(n.type) === tag,
  );
function button(label: string) {
  return hosts("Pressable").find(
    (n) =>
      n.props.accessibilityLabel === label ||
      n
        .findAll((c) => typeof c.type === "string" && String(c.type) === "Text")
        .some((c) => c.props.children === label),
  )!;
}
const view = (s: Fixture) =>
  createElement(ProductMasterConflict, { conflict: s.review.conflict });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup(
  kind: Kind,
  options: {
    reversal?: "LOCAL" | "REMOTE";
    remoteDeleted?: boolean;
    localDeleted?: boolean;
  } = {},
) {
  const s = await nativeCatalogueConflictFixture(
    kind,
    ":memory:",
    options.reversal,
    options.remoteDeleted ?? false,
    options.localDeleted ?? false,
    kind === "ALIAS" && options.localDeleted ? "WASTE_RECEIPT" : "USER",
  );
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
const tables = [
  "products",
  "product_identifiers",
  "product_aliases",
  "sync_outbox",
  "sync_conflicts",
  "product_master_conflict_history",
  "source_documents",
  "waste_receipts",
  "waste_lines",
  "sales_observations",
  "waste_observations",
];
const snapshot = (s: Fixture) =>
  tables.map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
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
for (const kind of ["PRODUCT", "IDENTIFIER", "ALIAS"] as const)
  it.each(
    kind === "ALIAS"
      ? ([
          "OWNER",
          "ACTIVE_STORE",
          "DEVICE",
          "DATABASE",
          "ROLE",
          "TARGET",
          "BLUR",
          "UNMOUNT",
        ] as const)
      : (["OWNER", "ACTIVE_STORE", "DEVICE"] as const),
  )(
    `${kind} refuses a delayed decision after native %s changes`,
    async (mode) => {
      const s = await setup(kind),
        before = snapshot(s),
        entered = deferred(),
        gate = deferred();
      await act(async () =>
        button("Conserver ma version locale").props.onPress(),
      );
      await act(async () =>
        hosts("Switch")
          .find(
            (n) =>
              n.props.accessibilityLabel ===
              "J’ai comparé les deux versions et je confirme mon choix",
          )!
          .props.onValueChange(true),
      );
      runtime.hold = { entered: entered.resolve, promise: gate.promise };
      await act(async () => {
        button("Confirmer cette résolution").props.onPress();
        await entered.promise;
      });
      await act(async () => {
        if (mode === "OWNER")
          runtime.session = {
            user: { id: randomUUID() },
            stores: [{ storeId: s.scope.storeId, role: "MANAGER" }],
          };
        if (mode === "ACTIVE_STORE")
          runtime.session = {
            user: { id: s.scope.ownerId },
            stores: [
              { storeId: randomUUID(), role: "MANAGER" },
              { storeId: s.scope.storeId, role: "MANAGER" },
            ],
          };
        if (mode === "DEVICE")
          runtime.database = { sqlite: s.a, deviceId: randomUUID() };
        if (mode === "DATABASE") {
          const other = await nativeCatalogueConflictFixture(kind);
          fixtures.push(other);
          runtime.database = { sqlite: other.a, deviceId: s.scope.deviceId };
        }
        if (mode === "ROLE")
          runtime.session = {
            user: { id: s.scope.ownerId },
            stores: [{ storeId: s.scope.storeId, role: "VIEWER" }],
          };
        if (mode === "BLUR") runtime.focused = false;
        if (mode === "UNMOUNT") {
          tree!.unmount();
          tree = undefined;
        } else
          tree!.update(
            mode === "TARGET"
              ? createElement(ProductMasterConflict, {
                  conflict: {
                    ...s.review.conflict,
                    id: randomUUID(),
                    entityId: randomUUID(),
                  },
                })
              : view(s),
          );
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

function compareSwitch() {
  return hosts("Switch").find(
    (n) =>
      n.props.accessibilityLabel ===
      "J’ai comparé les deux versions et je confirme mon choix",
  )!;
}
async function compare() {
  await act(async () => compareSwitch().props.onValueChange(true));
}
async function confirm() {
  await act(async () => button("Confirmer cette résolution").props.onPress());
}
async function current(s: Fixture) {
  const r = new ProductMasterRepository(s.a);
  return s.review.kind === "PRODUCT"
    ? r.getProduct(s.review.local.id)
    : s.review.kind === "IDENTIFIER"
      ? r.getIdentifier(s.review.local.id)
      : r.getAlias(s.review.local.id);
}
for (const kind of ["PRODUCT", "IDENTIFIER", "ALIAS"] as const) {
  it.each([true, false])(
    `${kind} requires a comparison and commits only one explicit choice (local=%s)`,
    async (local) => {
      const s = await setup(kind);
      await act(async () =>
        button(
          local
            ? "Conserver ma version locale"
            : "Adopter la version synchronisée",
        ).props.onPress(),
      );
      expect(button("Confirmer cette résolution").props.disabled).toBe(true);
      await compare();
      const action = button("Confirmer cette résolution").props.onPress;
      await act(async () => {
        action();
        action();
      });
      expect(s.count("product_master_conflict_history")).toBe(1);
      expect((await current(s))!.entity.version).toBe(local ? 3 : 2);
      expect(
        await new OutboxRepository(s.a).listPending(s.scope.storeId),
      ).toHaveLength(local ? 1 : 0);
      expect(runtime.back).toHaveBeenCalledTimes(1);
      expect(runtime.sync).toHaveBeenCalledTimes(1);
      if (kind === "ALIAS")
        expect(
          (await new ProductMasterRepository(s.a).getAlias(s.review.local.id))!
            .entity.confidence,
        ).toBe(
          "confidence" in s.review.remote ? s.review.remote.confidence : null,
        );
    },
  );
  it(`${kind} clears the selected side and consent after a newer typed pull`, async () => {
    const s = await setup(kind);
    await act(async () =>
      button("Conserver ma version locale").props.onPress(),
    );
    await compare();
    const newer = { ...s.review.remote, version: 3 };
    await applyProductMasterChange(s.a, s.scope.storeId, {
      entityType: s.review.entityType,
      entityId: newer.id,
      entityVersion: 3,
      operation: "UPSERT",
      entity: newer,
    });
    await confirm();
    expect(s.count("product_master_conflict_history")).toBe(0);
    expect(compareSwitch().props.value).toBe(false);
    expect(button("Confirmer cette résolution").props.disabled).toBe(true);
    await act(async () => button("Relire la comparaison").props.onPress());
    expect(compareSwitch().props.value).toBe(false);
    await act(async () =>
      button("Conserver ma version locale").props.onPress(),
    );
    await compare();
    await confirm();
    expect((await current(s))!.entity.version).toBe(4);
  });
  it.each([true, false])(
    `${kind} separately confirms maintaining or undoing a local deletion (local=%s)`,
    async (local) => {
      const s = await setup(kind, { localDeleted: true });
      const label = local
        ? "Maintenir ma suppression locale"
        : "Annuler ma suppression et rétablir la version synchronisée";
      await act(async () => button(label).props.onPress());
      await compare();
      expect(button("Confirmer cette résolution").props.disabled).toBe(true);
      const consent = () =>
        hosts("Switch").find((n) =>
          String(n.props.accessibilityLabel).includes(
            local
              ? "maintien de ma suppression"
              : "annulation de ma suppression",
          ),
        )!;
      await act(async () => consent().props.onValueChange(true));
      expect(button("Confirmer cette résolution").props.disabled).toBe(false);
      await act(async () => button("Relire la comparaison").props.onPress());
      await act(async () => button(label).props.onPress());
      await compare();
      expect(consent().props.value).toBe(false);
      expect(button("Confirmer cette résolution").props.disabled).toBe(true);
      await act(async () => consent().props.onValueChange(true));
      await confirm();
      expect(!!(await current(s))!.entity.deletedAt).toBe(local);
      expect(
        await new OutboxRepository(s.a).listPending(s.scope.storeId),
      ).toHaveLength(local ? 1 : 0);
      if (kind === "ALIAS")
        expect(
          (await new ProductMasterRepository(s.a).getAlias(s.review.local.id))!
            .entity.source,
        ).toBe("WASTE_RECEIPT");
    },
  );
  it(`${kind} separately confirms adopting a remote deletion without queuing a restoration`, async () => {
    const s = await setup(kind, { remoteDeleted: true });
    expect(button("Conserver ma version locale").props.disabled).toBe(true);
    await act(async () =>
      button("Accepter la suppression synchronisée").props.onPress(),
    );
    await compare();
    expect(button("Confirmer cette résolution").props.disabled).toBe(true);
    const consent = hosts("Switch").find((n) =>
      String(n.props.accessibilityLabel).includes(
        "acceptation de la suppression synchronisée",
      ),
    )!;
    await act(async () => consent.props.onValueChange(true));
    await confirm();
    expect(await current(s)).toMatchObject({
      entity: { id: s.review.remote.id, deletedAt: s.review.remote.deletedAt },
      syncState: "SYNCED",
      dirty: false,
    });
    expect(
      await new OutboxRepository(s.a).listPending(s.scope.storeId),
    ).toEqual([]);
  });
}
it.each(["PRODUCT", "ALIAS"] as const)(
  "%s preserves a separate activation/reactivation decision after reread",
  async (kind) => {
    const s = await setup(kind, { reversal: "REMOTE" });
    await act(async () =>
      button("Conserver ma version locale").props.onPress(),
    );
    await compare();
    expect(button("Confirmer cette résolution").props.disabled).toBe(true);
    const extra = () =>
      hosts("Switch").find((n) =>
        String(n.props.accessibilityLabel).includes(
          kind === "PRODUCT" ? "remise en activité" : "réactivation de l’alias",
        ),
      )!;
    await act(async () => extra().props.onValueChange(true));
    await act(async () => button("Relire la comparaison").props.onPress());
    await act(async () =>
      button("Conserver ma version locale").props.onPress(),
    );
    await compare();
    expect(extra().props.value).toBe(false);
    expect(button("Confirmer cette résolution").props.disabled).toBe(true);
    await act(async () => extra().props.onValueChange(true));
    await confirm();
    expect(s.count("product_master_conflict_history")).toBe(1);
  },
);
it("keeps readable values after a failed reread without retaining the old confirmation", async () => {
  const s = await setup("ALIAS");
  vi.spyOn(s.a, "getFirstAsync").mockRejectedValueOnce(Error("READ_FAILED"));
  await act(async () => button("Relire la comparaison").props.onPress());
  expect(
    hosts("Text").some((n) =>
      String(n.props.children).includes("Figues jaunes"),
    ),
  ).toBe(true);
  expect(button("Confirmer cette résolution").props.disabled).toBe(true);
  await act(async () => button("Relire la comparaison").props.onPress());
  await act(async () => button("Conserver ma version locale").props.onPress());
  await compare();
  await confirm();
  expect(s.count("product_master_conflict_history")).toBe(1);
});
it("does not report a failed local choice when synchronization rejects after commit", async () => {
  const s = await setup("ALIAS");
  runtime.sync.mockRejectedValueOnce(Error("OFFLINE"));
  await act(async () => button("Conserver ma version locale").props.onPress());
  await compare();
  await confirm();
  expect(s.count("product_master_conflict_history")).toBe(1);
  expect(
    hosts("Text").some((n) =>
      String(n.props.children).includes("Comparaison enregistrée"),
    ),
  ).toBe(true);
  expect(runtime.back).toHaveBeenCalledTimes(1);
});
it("rejects an old rendered confirmation callback after rereading", async () => {
  const s = await setup("ALIAS");
  await act(async () => button("Conserver ma version locale").props.onPress());
  await compare();
  const old = button("Confirmer cette résolution").props.onPress,
    before = snapshot(s);
  await act(async () => button("Relire la comparaison").props.onPress());
  await act(async () => old());
  expect(snapshot(s)).toEqual(before);
});

it.each([false, true])(
  "allows explicit adoption of an already synchronized product while keeping separate confirmation (legacy=%s)",
  async (legacy) => {
    const s = await setup("PRODUCT"),
      r = s.review;
    await applyProductMasterChange(
      s.a,
      s.scope.storeId,
      {
        entityType: r.entityType,
        entityId: r.remote.id,
        entityVersion: r.remote.version,
        operation: "UPSERT",
        entity: r.remote,
      },
      r.local.version,
    );
    if (legacy)
      await s.a.runAsync(
        "DELETE FROM product_master_remote_snapshots WHERE entity_id=?",
        r.remote.id,
      );
    await act(async () => button("Relire la comparaison").props.onPress());
    expect(button("Conserver ma version locale").props.disabled).toBe(true);
    expect(button("Adopter la version synchronisée").props.disabled).toBe(
      false,
    );
    expect(button("Confirmer cette résolution").props.disabled).toBe(true);
    await act(async () =>
      button("Adopter la version synchronisée").props.onPress(),
    );
    expect(button("Confirmer cette résolution").props.disabled).toBe(true);
    await compare();
    await confirm();
    expect(s.count("product_master_conflict_history")).toBe(1);
    expect(
      s.db
        .prepare("SELECT COUNT(*) n FROM sync_conflicts WHERE status='OPEN'")
        .get()!.n,
    ).toBe(0);
    expect(
      await new OutboxRepository(s.a).listPending(s.scope.storeId),
    ).toHaveLength(0);
  },
);

it.each(["SYNCED", "PENDING", "ERROR"] as const)(
  "rereads and explicitly adopts a verified product despite a stale %s flag and timestamp",
  async (state) => {
    const s = await setup("PRODUCT"),
      r = s.review;
    await applyProductMasterChange(
      s.a,
      s.scope.storeId,
      {
        entityType: r.entityType,
        entityId: r.remote.id,
        entityVersion: r.remote.version,
        operation: "UPSERT",
        entity: r.remote,
      },
      r.local.version,
    );
    await s.a.runAsync(
      "UPDATE products SET sync_state=?,dirty=1,updated_at='2026-10-24T12:00:00.000Z' WHERE id=?",
      state,
      r.remote.id,
    );
    await act(async () => button("Relire la comparaison").props.onPress());
    expect(button("Conserver ma version locale").props.disabled).toBe(true);
    expect(button("Adopter la version synchronisée").props.disabled).toBe(
      false,
    );
    expect(s.count("product_master_conflict_history")).toBe(0);
    await act(async () =>
      button("Adopter la version synchronisée").props.onPress(),
    );
    expect(button("Confirmer cette résolution").props.disabled).toBe(true);
    await compare();
    await confirm();
    expect(s.count("product_master_conflict_history")).toBe(1);
    expect(await current(s)).toMatchObject({
      entity: r.remote,
      syncState: "SYNCED",
      dirty: false,
    });
    expect(
      await new OutboxRepository(s.a).listPending(s.scope.storeId),
    ).toHaveLength(0);
  },
);
