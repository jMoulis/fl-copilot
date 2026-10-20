import { expect, it } from "vitest";
import { visualLibraryFixture } from "../../../../scripts/test-visual-library-fixtures";
import {
  resolveLibraryState,
  visualTransferLabel,
  productVisualRecoveryTargets,
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
