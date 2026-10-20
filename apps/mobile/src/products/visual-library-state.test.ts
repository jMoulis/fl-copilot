import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { ProductMasterRepository } from "./product-master-repository";
import { applyVisualEntity } from "./visual-library-repository";
import { visualLibraryFixture } from "../../../../scripts/test-visual-library-fixtures";
import {
  resolveLibraryState,
  visualTransferLabel,
  productVisualRecoveryTargets,
  resolveLibraryProduct,
  shareVisualLibraryState,
  loadVisualLibraryState,
  type VisualLibraryState,
} from "./visual-library-state";
import type { LocalVisualRecord } from "./visual-library-repository";
const record = <T>(entity: T): LocalVisualRecord<T> => ({
  entity,
  remote: entity,
  remoteVersion: 1,
  dirty: false,
  syncState: "SYNCED",
});
function setup() {
  const f = visualLibraryFixture();
  const state: VisualLibraryState = {
    storeId: f.storeId,
    products: new Map([
      [
        f.product.id,
        {
          entity: f.product,
          remoteVersion: 1,
          dirty: false,
          syncState: "SYNCED",
        },
      ],
    ]),
    unavailableProducts: new Set(),
    assets: new Map([[f.asset.id, record(f.asset)]]),
    identities: new Map([[f.identity.id, record(f.identity)]]),
    links: new Map([[f.product.id, [record(f.link)]]]),
    files: new Map(),
    jobs: new Map(),
  };
  return { f, state };
}
it("resolves an indexed library without scanning or inferring product names, and masks a known removed parent", () => {
  const { f, state } = setup();
  expect(resolveLibraryState(state, f.product)).toMatchObject({
    kind: "ASSET",
    asset: { id: f.asset.id },
  });
  state.identities.set(f.identity.id, {
    ...record(f.identity),
    dirty: true,
    remote: { ...f.identity, version: 2, deletedAt: f.at },
  });
  expect(resolveLibraryState(state, f.product).kind).toBe("PLACEHOLDER");
});
it("never turns a conflicting duplicate link into permission to display the remaining valid one", () => {
  const { f, state } = setup();
  state.links.set(f.product.id, [
    record(f.link),
    { ...record({ ...f.link, id: f.actorId }), syncState: "CONFLICT" },
  ]);
  expect(resolveLibraryState(state, f.product).kind).toBe("PLACEHOLDER");
  expect(
    resolveLibraryState({ ...state, storeId: f.actorId }, f.product).kind,
  ).toBe("PLACEHOLDER");
});
it("keeps rejected linked metadata reachable in dependency order even after a link tombstone, without inventing name matches", () => {
  const { f, state } = setup();
  state.assets.set(f.asset.id, { ...record(f.asset), syncState: "ERROR" });
  state.identities.set(f.identity.id, {
    ...record(f.identity),
    syncState: "ERROR",
  });
  state.links.set(f.product.id, [
    { ...record({ ...f.link, deletedAt: f.at }), syncState: "ERROR" },
  ]);
  expect(
    productVisualRecoveryTargets(state, f.product.id).map((t) => t.kind),
  ).toEqual(["visual_asset", "visual_identity", "product_visual_link"]);
  expect(productVisualRecoveryTargets(state, f.actorId)).toEqual([]);
  expect(productVisualRecoveryTargets(null, f.product.id)).toEqual([]);
});

it("resolves only real catalogue IDs in the requested store and hides deleted, conflicted or remotely removed products", () => {
  const { f, state } = setup();
  expect(resolveLibraryProduct(state, f.storeId, f.product.id).kind).toBe(
    "ASSET",
  );
  expect(resolveLibraryProduct(state, f.actorId, f.product.id)).toEqual({
    kind: "PLACEHOLDER",
    category: "UNKNOWN",
  });
  expect(resolveLibraryProduct(state, f.storeId, f.actorId).kind).toBe(
    "PLACEHOLDER",
  );
  const current = state.products.get(f.product.id)!;
  state.products.set(f.product.id, { ...current, syncState: "CONFLICT" });
  expect(resolveLibraryProduct(state, f.storeId, f.product.id).kind).toBe(
    "PLACEHOLDER",
  );
  state.products.set(f.product.id, current);
  state.unavailableProducts.add(f.product.id);
  expect(resolveLibraryState(state, f.product).kind).toBe("PLACEHOLDER");
  state.unavailableProducts.clear();
  state.products.delete(f.product.id);
  expect(resolveLibraryProduct(state, f.storeId, f.product.id).kind).toBe(
    "PLACEHOLDER",
  );
});

it("keeps unchanged query records stable through heartbeats while a file retry renews its read epoch", () => {
  const { f, state } = setup();
  expect(shareVisualLibraryState(state, structuredClone(state))).toBe(state);
  const job = {
    id: f.actorId,
    payload_json: "{}",
    status: "RUNNING",
    attempt_count: 1,
    last_error: null,
    updated_at: f.at,
    next_attempt_at: null,
  };
  state.jobs.set(f.asset.id, [job]);
  const next = structuredClone(state);
  next.jobs.set(f.asset.id, [{ ...job, status: "COMPLETED" }]);
  const shared = shareVisualLibraryState(state, next);
  expect(shared).not.toBe(state);
  expect(shared.assets).toBe(state.assets);
  expect(shared.files).toBe(state.files);
  expect(shared.products).toBe(state.products);
  expect(shared.jobs).not.toBe(state.jobs);
  expect(state.jobs.get(f.asset.id)?.[0]?.status).toBe("RUNNING");
  const removed = structuredClone(state);
  removed.unavailableProducts.add(f.product.id);
  expect(
    resolveLibraryProduct(
      shareVisualLibraryState(state, removed),
      f.storeId,
      f.product.id,
    ).kind,
  ).toBe("PLACEHOLDER");
});

it("uses indexed explicit links in a representative catalogue instead of scanning similar labels for each tile", () => {
  const { f, state } = setup(),
    first = state.products.get(f.product.id)!;
  let unrelated = "";
  for (let i = 0; i < 5000; i++) {
    unrelated = `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
    state.products.set(unrelated, {
      ...first,
      entity: { ...f.product, id: unrelated },
    });
  }
  for (const map of [
    state.products,
    state.assets,
    state.identities,
    state.links,
  ]) {
    map.values = () => {
      throw Error("Unexpected full-library scan during tile resolution");
    };
    map[Symbol.iterator] = () => {
      throw Error("Unexpected full-library scan during tile resolution");
    };
  }
  expect(resolveLibraryProduct(state, f.storeId, f.product.id).kind).toBe(
    "ASSET",
  );
  expect(resolveLibraryProduct(state, f.storeId, unrelated).kind).toBe(
    "PLACEHOLDER",
  );
});

it("loads actual store products and honours remote removal even while an old local product is retained", async () => {
  const f = visualLibraryFixture(),
    db = new VisualTestDatabase(new DatabaseSync(":memory:"));
  try {
    await runLocalMigrations(db);
    const products = new ProductMasterRepository(db);
    await products.upsertProduct(f.product, {
      commandId: randomUUID(),
      deviceId: f.deviceId,
    });
    const foreign = { ...f.product, id: randomUUID(), storeId: randomUUID() };
    await products.upsertProduct(foreign, {
      commandId: randomUUID(),
      deviceId: f.deviceId,
    });
    await applyVisualEntity(db, f.storeId, "visual_asset", f.asset);
    await applyVisualEntity(db, f.storeId, "visual_identity", f.identity);
    await applyVisualEntity(db, f.storeId, "product_visual_link", f.link);
    let state = await loadVisualLibraryState(db, f.storeId, f.actorId);
    expect(state.products.get(f.product.id)?.entity).toEqual(f.product);
    expect(state.products.has(foreign.id)).toBe(false);
    expect(resolveLibraryProduct(state, f.storeId, f.product.id).kind).toBe(
      "ASSET",
    );
    await db.runAsync(
      "INSERT INTO product_master_remote_snapshots(store_id,entity_type,entity_id,version,operation,payload_json) VALUES(?,'product',?,2,'DELETE',NULL)",
      f.storeId,
      f.product.id,
    );
    state = await loadVisualLibraryState(db, f.storeId, f.actorId);
    expect(state.products.has(f.product.id)).toBe(true);
    expect(resolveLibraryProduct(state, f.storeId, f.product.id).kind).toBe(
      "PLACEHOLDER",
    );
  } finally {
    db.raw.close();
  }
});

it("keeps transfer status distinct from metadata and does not claim pixels are present from a registry alone", () => {
  const { f, state } = setup();
  expect(visualTransferLabel(state, f.asset.id)).toBe(
    "Aperçu non enregistré sur cet appareil",
  );
  state.files.set(f.asset.id, {
    source: true,
    preview: false,
    uploaded: false,
  });
  expect(visualTransferLabel(state, f.asset.id)).toBe(
    "Original conservé · envoi en attente",
  );
  state.files.set(f.asset.id, { source: true, preview: true, uploaded: true });
  expect(visualTransferLabel(state, f.asset.id)).toBe(
    "Image vérifiée et envoyée",
  );
  state.assets.set(f.asset.id, { ...record(f.asset), dirty: true });
  expect(visualTransferLabel(state, f.asset.id)).toBe(
    "Métadonnées à synchroniser",
  );
});
