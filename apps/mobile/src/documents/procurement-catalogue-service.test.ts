import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  procurementLinksFixture,
  linkTime,
} from "../../../../scripts/test-procurement-links-fixtures";
import { procurementFixture } from "../../../../scripts/test-procurement-fixtures";
import { procurementHash } from "../../../../scripts/test-procurement-publication-fixtures";
import { ProcurementCatalogueDraftRepository } from "./procurement-catalogue-draft";
import { ProcurementPublicationRepository } from "./procurement-publication";
import {
  procurementPreview,
  procurementReadyRows,
  confirmProcurementImport,
  productProcurementOffers,
  productProcurementEnrichment,
  confirmProcurementEnrichment,
} from "./procurement-catalogue-service";
const close: (() => void)[] = [];
afterEach(() => {
  for (const f of close.splice(0)) f();
});
async function fixture(unpublished = true) {
  const f = await procurementLinksFixture();
  close.push(() => f.device.raw.close());
  f.device.raw
    .prepare(
      "UPDATE source_documents SET parser_version='mercalys-article-reference.v1',local_processing_status='PUBLISHED' WHERE id=?",
    )
    .run(f.referenceId);
  if (unpublished) {
    f.device.raw.exec(
      "DELETE FROM procurement_catalogue_snapshots;DELETE FROM sync_outbox;DELETE FROM local_jobs;",
    );
  }
  const files = new Map([
    [f.input.localUri, f.bytes],
    ["file:///reference.xlsx", f.referenceBytes],
  ]);
  const originals = {
    sha256: procurementHash,
    read: async (uri: string) => {
      const b = files.get(uri);
      if (!b) throw Error("MISSING");
      return b;
    },
  };
  const ctx = () => ({
    storeId: f.product.storeId,
    actorId: f.ownerId,
    deviceId: f.publicationInput.deviceId,
    now: () => linkTime,
    id: randomUUID,
    assertCurrentScope: () => {},
  });
  const draft = await new ProcurementCatalogueDraftRepository(
    f.device,
    originals,
  ).get(f.product.storeId, f.ownerId, f.input.checksum);
  const preview = () =>
    procurementPreview(f.device, draft!, f.referenceId, originals);
  return { ...f, files, originals, ctx, preview };
}
it("confirms the snapshot and ready links atomically, without Product or PA writes, then resumes idempotently", async () => {
  const f = await fixture(),
    preview = await f.preview();
  expect(procurementReadyRows(preview)).toHaveLength(1);
  const products = f.device.raw.prepare("SELECT * FROM products").all();
  const p = await confirmProcurementImport(
    f.device,
    preview,
    [],
    f.originals,
    f.ctx(),
  );
  expect(
    f.device.raw
      .prepare("SELECT entity_type FROM sync_outbox ORDER BY local_sequence")
      .all(),
  ).toEqual([
    { entity_type: "procurement_catalogue_snapshot" },
    { entity_type: "procurement_link_review" },
  ]);
  expect(f.device.raw.prepare("SELECT * FROM products").all()).toEqual(
    products,
  );
  expect(
    f.device.raw
      .prepare("SELECT COUNT(*) n FROM purchase_price_observations")
      .get(),
  ).toEqual({ n: 0 });
  const resumed = await f.preview();
  expect(procurementReadyRows(resumed)).toEqual([]);
  expect(
    (
      await confirmProcurementImport(
        f.device,
        resumed,
        [],
        f.originals,
        f.ctx(),
      )
    ).id,
  ).toBe(p.id);
  expect(
    f.device.raw.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
  ).toEqual({ n: 2 });
  const offers = await productProcurementOffers(
    f.device,
    f.product.storeId,
    f.product.id,
  );
  expect(offers).toHaveLength(2);
  expect(offers[0]!.syncState).toBe("PENDING");
});
it("rolls back the publication, upload job and all links when a manual choice is invalid", async () => {
  const f = await fixture(),
    preview = await f.preview();
  await expect(
    confirmProcurementImport(
      f.device,
      preview,
      [
        {
          genericId: "005002",
          sourceIndex: 3,
          productId: randomUUID(),
          reason: "Contrôlé",
        },
      ],
      f.originals,
      f.ctx(),
    ),
  ).rejects.toThrow();
  for (const table of [
    "procurement_catalogue_snapshots",
    "procurement_product_links",
    "procurement_link_reviews",
    "sync_outbox",
    "local_jobs",
  ])
    expect(
      f.device.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get(),
    ).toEqual({ n: 0 });
});
it("rolls back the entire action if the account/store scope changes after publication started", async () => {
  const f = await fixture(),
    preview = await f.preview();
  const ctx = f.ctx();
  ctx.assertCurrentScope = () => {
    if (
      f.device.raw
        .prepare("SELECT id FROM procurement_catalogue_snapshots")
        .get()
    )
      throw Error("SCOPE_CHANGED");
  };
  await expect(
    confirmProcurementImport(f.device, preview, [], f.originals, ctx),
  ).rejects.toThrow("SCOPE_CHANGED");
  expect(
    f.device.raw.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
  ).toEqual({ n: 0 });
  expect(
    f.device.raw
      .prepare("SELECT COUNT(*) n FROM procurement_catalogue_snapshots")
      .get(),
  ).toEqual({ n: 0 });
});
it("does not silently resurrect withdrawn links or accept a stale preview", async () => {
  const f = await fixture(false),
    preview = await f.preview();
  await f.links.confirmBatch([f.link], f.context());
  await expect(
    confirmProcurementImport(f.device, preview, [], f.originals, f.ctx()),
  ).rejects.toThrow("PROCUREMENT_PREVIEW_CHANGED");
  f.device.raw
    .prepare(
      "UPDATE procurement_product_links SET payload_json=json_set(payload_json,'$.status','WITHDRAWN'),sync_state='SYNCED'",
    )
    .run();
  expect(procurementReadyRows(await f.preview())).toEqual([]);
});
it("can retain an unmatched catalogue before a reference is available, leaving all original identities unchanged", async () => {
  const f = await fixture();
  const preview = await procurementPreview(
    f.device,
    f.draft,
    null,
    f.originals,
  );
  await confirmProcurementImport(f.device, preview, [], f.originals, f.ctx());
  expect(
    f.device.raw
      .prepare("SELECT COUNT(*) n FROM procurement_catalogue_snapshots")
      .get(),
  ).toEqual({ n: 1 });
  expect(
    f.device.raw
      .prepare("SELECT COUNT(*) n FROM procurement_product_links")
      .get(),
  ).toEqual({ n: 0 });
});
it("shows dated latest offers without filling a missing quote from an older tariff", async () => {
  const f = await fixture(false);
  await f.links.confirmBatch([f.link], f.context());
  const source = procurementFixture();
  source.assortment.lastUpdate = "2026-11-22T05:00:00.000Z";
  source.assortment.articles = [];
  const bytes = new Uint8Array(Buffer.from(JSON.stringify(source))),
    uri = "file:///next.json";
  f.files.set(uri, bytes);
  const input = {
    ...f.input,
    id: randomUUID(),
    sourceDocumentId: randomUUID(),
    sourceRecordId: randomUUID(),
    fileId: randomUUID(),
    localUri: uri,
    checksum: await procurementHash(bytes),
  };
  const { draft } = await new ProcurementCatalogueDraftRepository(
    f.device,
    f.originals,
  ).stage(input, () => {});
  await new ProcurementPublicationRepository(f.device, f.originals).publish(
    {
      ...f.publicationInput,
      checksum: input.checksum,
      normalizedChecksum: draft.normalizedChecksum,
      commandId: randomUUID(),
    },
    () => {},
  );
  const offers = await productProcurementOffers(
    f.device,
    f.product.storeId,
    f.product.id,
  );
  expect(offers).toHaveLength(2);
  expect(offers.every((o) => o.offer.tariff === null)).toBe(true);
  expect(offers[0]!.asOf).toBe(source.assortment.lastUpdate);
});
it("applies reviewed metadata through the canonical Product writer, preserving units, IDs and unknown Petit Prix", async () => {
  const f = await fixture(false);
  await f.links.confirmBatch([f.link], f.context());
  f.device.raw
    .prepare("UPDATE products SET nature='UNKNOWN',category='UNKNOWN'")
    .run();
  const expected = await productProcurementEnrichment(
    f.device,
    f.product.storeId,
    f.product.id,
  );
  expect(expected!.proposal.nature.state).toBe("PROPOSED");
  await confirmProcurementEnrichment(
    f.device,
    expected!,
    { nature: true, packaging: false, petitPrix: false, category: "VEGETABLE" },
    f.ctx(),
  );
  const p = await f.device.getFirstAsync<{
    id: string;
    sales_unit: string;
    is_petit_prix: number | null;
    nature: string;
  }>("SELECT id,sales_unit,is_petit_prix,nature FROM products");
  expect(p).toEqual({
    id: f.product.id,
    sales_unit: "KG",
    is_petit_prix: null,
    nature: "BULK",
  });
  expect(
    f.device.raw
      .prepare("SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='product'")
      .get(),
  ).toEqual({ n: 1 });
  await expect(
    confirmProcurementEnrichment(
      f.device,
      expected!,
      { nature: true, packaging: false, petitPrix: false },
      f.ctx(),
    ),
  ).rejects.toThrow("PROCUREMENT_PREVIEW_CHANGED");
});

it("does not invalidate reviewed choices for an ordinary synchronization acknowledgment", async () => {
  const f = await fixture(false);
  await f.links.confirmBatch([f.link], f.context());
  const a = await f.preview();
  f.device.raw
    .prepare(
      "UPDATE procurement_product_links SET sync_state='SYNCED',dirty=0,remote_version=1",
    )
    .run();
  expect((await f.preview()).signature).toBe(a.signature);
});
it("hides stale offer ownership and refuses metadata changes after source codes move to another fiche", async () => {
  const f = await fixture(false);
  await f.links.confirmBatch([f.link], f.context());
  f.device.raw
    .prepare("UPDATE product_identifiers SET product_id=? WHERE type=?")
    .run(randomUUID(), "EAN");
  expect(
    await productProcurementOffers(f.device, f.product.storeId, f.product.id),
  ).toEqual([]);
  await expect(
    productProcurementEnrichment(f.device, f.product.storeId, f.product.id),
  ).rejects.toThrow("PROCUREMENT_LINK_CHOICE_CHANGED");
});

it("distinguishes a missing store PDV from a catalogue for another point of sale", async () => {
  const f = await fixture();
  f.device.raw
    .prepare(
      "UPDATE store_context_settings SET payload_json=json_set(payload_json,'$.pdvCode','99999')",
    )
    .run();
  await expect(f.preview()).rejects.toThrow("PROCUREMENT_PDV_MISMATCH");
  f.device.raw
    .prepare(
      "UPDATE store_context_settings SET payload_json=json_set(payload_json,'$.pdvCode',NULL)",
    )
    .run();
  await expect(f.preview()).rejects.toThrow("PROCUREMENT_STORE_PDV_REQUIRED");
  expect(
    f.device.raw.prepare("SELECT COUNT(*) n FROM sync_outbox").get(),
  ).toEqual({ n: 0 });
});
