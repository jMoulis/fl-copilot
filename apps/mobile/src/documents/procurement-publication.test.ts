import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { procurementPublicationFixture } from "../../../../scripts/test-procurement-publication-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { procurementFixture } from "../../../../scripts/test-procurement-fixtures";
import { procurementHash } from "../../../../scripts/test-procurement-publication-fixtures";
import { ProcurementCatalogueDraftRepository } from "./procurement-catalogue-draft";
import {
  applyProcurementCatalogue,
  ProcurementPublicationRepository,
} from "./procurement-publication";
const close: DatabaseSync[] = [];

it.each([false, true])(
  "does not republish the same dated catalogue when unrelated source branches change (tariff changed: %s)",
  async (changed) => {
    const f = await procurementPublicationFixture();
    close.push(f.device.raw);
    const first = await f.repository.publish(
      f.publicationInput,
      () => undefined,
    );
    const source = procurementFixture();
    source.news.push({ text: "New unrelated news" });
    if (changed) source.assortment.articles[0]!.purchasePrice = 0.5;
    const bytes = new Uint8Array(Buffer.from(JSON.stringify(source)));
    const originals = { read: async () => bytes, sha256: procurementHash };
    const input = {
      ...f.input,
      id: randomUUID(),
      sourceDocumentId: randomUUID(),
      sourceRecordId: randomUUID(),
      fileId: randomUUID(),
      localUri: "file:///procurement-catalogues/second.json",
      checksum: await procurementHash(bytes),
    };
    const { draft } = await new ProcurementCatalogueDraftRepository(
      f.device,
      originals,
    ).stage(input, () => undefined);
    const publishing = new ProcurementPublicationRepository(
      f.device,
      originals,
    ).publish(
      {
        ...f.publicationInput,
        checksum: input.checksum,
        normalizedChecksum: draft.normalizedChecksum,
        commandId: randomUUID(),
      },
      () => undefined,
    );
    if (changed)
      await expect(publishing).rejects.toThrow("PROCUREMENT_ASOF_CONFLICT");
    else expect(await publishing).toEqual(first);
    expect(
      f.device.raw.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get(),
    ).toEqual({ n: 1 });
    expect(
      f.device.raw
        .prepare(
          "SELECT COUNT(*) AS n FROM local_files WHERE retention_status='RETAINED'",
        )
        .get(),
    ).toEqual({ n: 2 });
  },
);
afterEach(() => {
  for (const db of close.splice(0)) db.close();
});
it("publishes exactly one immutable packet plus an owner-scoped upload atomically; pull restores it on another device", async () => {
  const f = await procurementPublicationFixture();
  close.push(f.device.raw);
  const p = await f.repository.publish(f.publicationInput, () => undefined);
  expect(
    await f.repository.publish(
      {
        ...f.publicationInput,
        commandId: randomUUID(),
        confirmedAt: "2026-11-22T10:00:00.000Z",
      },
      () => undefined,
    ),
  ).toEqual(p);
  expect(
    f.device.raw
      .prepare("SELECT entity_id,entity_type,command_type FROM sync_outbox")
      .get(),
  ).toEqual({
    entity_id: p.id,
    entity_type: "procurement_catalogue_snapshot",
    command_type: "PROCUREMENT_CATALOGUE_PUBLISH",
  });
  expect(
    f.device.raw.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get(),
  ).toEqual({ n: 1 });
  expect(
    JSON.parse(
      String(
        f.device.raw.prepare("SELECT payload_json FROM local_jobs").get()
          ?.payload_json,
      ),
    ),
  ).toMatchObject({ ownerId: f.ownerId, sourceDocumentId: p.sourceDocumentId });
  const second = new VisualTestDatabase(new DatabaseSync(":memory:"));
  close.push(second.raw);
  await runLocalMigrations(second);
  const entity = { id: p.id, storeId: p.storeId, version: 1, publication: p };
  await second.withExclusiveTransactionAsync((tx) =>
    applyProcurementCatalogue(tx, p.storeId, entity),
  );
  await second.withExclusiveTransactionAsync((tx) =>
    applyProcurementCatalogue(tx, p.storeId, entity),
  );
  expect(
    second.raw
      .prepare("SELECT COUNT(*) AS n FROM procurement_catalogue_snapshots")
      .get(),
  ).toEqual({ n: 1 });
  expect(
    second.raw
      .prepare(
        "SELECT local_processing_status,sync_state FROM source_documents",
      )
      .get(),
  ).toEqual({ local_processing_status: "PUBLISHED", sync_state: "SYNCED" });
  expect(
    second.raw.prepare("SELECT COUNT(*) AS n FROM source_records").get(),
  ).toEqual({ n: 1 });
  for (const table of [
    "products",
    "purchase_price_observations",
    "sales_observations",
    "waste_observations",
    "sync_outbox",
  ])
    expect(
      second.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(),
    ).toEqual({ n: 0 });
  const changed = structuredClone(entity);
  changed.publication.catalogue.offers[0]!.weight = "9";
  await expect(
    second.withExclusiveTransactionAsync((tx) =>
      applyProcurementCatalogue(tx, p.storeId, changed),
    ),
  ).rejects.toThrow("PROCUREMENT_SNAPSHOT_IMMUTABLE");
  await expect(
    second.withExclusiveTransactionAsync((tx) =>
      applyProcurementCatalogue(tx, randomUUID(), entity),
    ),
  ).rejects.toThrow("PROCUREMENT_SNAPSHOT_SCOPE_INVALID");
});
it("rolls back publication and upload intent together, and rejects stale previews, changed originals and missing PDV", async () => {
  const f = await procurementPublicationFixture();
  close.push(f.device.raw);
  f.device.raw.exec(
    "CREATE TRIGGER reject_procurement BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END",
  );
  await expect(
    f.repository.publish(f.publicationInput, () => undefined),
  ).rejects.toThrow("TEST_FAILURE");
  for (const table of [
    "procurement_catalogue_snapshots",
    "sync_outbox",
    "local_jobs",
  ])
    expect(
      f.device.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(),
    ).toEqual({ n: 0 });
  expect(
    f.device.raw
      .prepare("SELECT local_processing_status FROM source_documents")
      .get(),
  ).toEqual({ local_processing_status: "TO_VALIDATE" });
  f.device.raw.exec("DROP TRIGGER reject_procurement");
  await expect(
    f.repository.publish(
      { ...f.publicationInput, normalizedChecksum: "sha256:" + "0".repeat(64) },
      () => undefined,
    ),
  ).rejects.toThrow("PROCUREMENT_DRAFT_CHANGED");
  const changed = new ProcurementPublicationRepository(f.device, {
    ...f.originals,
    read: async () => new Uint8Array([0]),
  });
  await expect(
    changed.publish(f.publicationInput, () => undefined),
  ).rejects.toThrow("PROCUREMENT_SOURCE_CHANGED");
  f.device.raw.exec(
    "UPDATE store_context_settings SET payload_json=json_remove(payload_json,'$.pdvCode')",
  );
  await expect(
    f.repository.publish(f.publicationInput, () => undefined),
  ).rejects.toThrow("PROCUREMENT_STORE_PDV_REQUIRED");
});
