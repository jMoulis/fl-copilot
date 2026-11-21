import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { procurementFixture } from "../../../../scripts/test-procurement-fixtures";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { ProcurementCatalogueDraftRepository } from "./procurement-catalogue-draft";
import { initSourceUploadRequestSchema } from "@fl-copilot/sync-contracts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const hash = async (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const storage = {
  read: async (uri: string) => new Uint8Array(readFileSync(fileURLToPath(uri))),
  sha256: hash,
};
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "procurement-draft-"));
  const path = join(dir, "local.sqlite");
  let db = new DatabaseSync(path);
  cleanups.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await runLocalMigrations(new VisualTestDatabase(db));
  const ids = () => ({
    id: randomUUID(),
    sourceDocumentId: randomUUID(),
    sourceRecordId: randomUUID(),
    fileId: randomUUID(),
  });
  const bytes = Buffer.from(JSON.stringify(procurementFixture()));
  writeFileSync(join(dir, "source.json"), bytes);
  const input = {
    ...ids(),
    storeId: randomUUID(),
    ownerId: randomUUID(),
    filename: "offers.json",
    localUri: pathToFileURL(join(dir, "source.json")).href,
    checksum: await hash(bytes),
    importedAt: "2026-11-21T10:00:00.000Z",
    expectedPdv: "09083",
  };
  return {
    input,
    ids,
    dir,
    get db() {
      return db;
    },
    repo: () =>
      new ProcurementCatalogueDraftRepository(
        new VisualTestDatabase(db),
        storage,
      ),
    reopen: () => {
      db.close();
      db = new DatabaseSync(path);
    },
  };
}

it("retains original and normalized snapshot across restart without publishing prices, products or upload jobs", async () => {
  const f = await setup();
  const staged = await f.repo().stage(f.input, () => undefined);
  expect(staged.duplicate).toBe(false);
  f.reopen();
  expect(
    await f.repo().get(f.input.storeId, f.input.ownerId, f.input.checksum),
  ).toEqual(staged.draft);
  const source = f.db.prepare("SELECT * FROM source_documents").get();
  expect(source).toMatchObject({
    local_processing_status: "TO_VALIDATE",
    sync_state: "LOCAL_ONLY",
    source_generated_at: "2026-11-21T05:02:40.133Z",
    business_period_start: null,
  });
  for (const table of [
    "products",
    "purchase_price_observations",
    "sales_observations",
    "waste_observations",
    "sync_outbox",
    "local_jobs",
  ])
    expect(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({
      n: 0,
    });
  expect(
    f.db
      .prepare("SELECT retention_status,upload_status FROM local_files")
      .get(),
  ).toEqual({ retention_status: "RETAINED", upload_status: "LOCAL_ONLY" });
  const normalized = f.db
    .prepare("SELECT normalized_payload_json FROM source_records")
    .get();
  expect(String(normalized?.normalized_payload_json)).not.toContain(
    "private-sender",
  );
  expect(readFileSync(fileURLToPath(f.input.localUri), "utf8")).toContain(
    "private-sender",
  );
  expect(
    await f.repo().get(randomUUID(), f.input.ownerId, f.input.checksum),
  ).toBeNull();
  expect(
    await f.repo().get(f.input.storeId, randomUUID(), f.input.checksum),
  ).toBeNull();
});

it("reimports exactly once with stable IDs and never deletes either file copy", async () => {
  const f = await setup();
  const first = await f.repo().stage(f.input, () => undefined);
  const secondPath = join(f.dir, "second.json");
  writeFileSync(secondPath, readFileSync(fileURLToPath(f.input.localUri)));
  const second = await f
    .repo()
    .stage(
      { ...f.input, ...f.ids(), localUri: pathToFileURL(secondPath).href },
      () => undefined,
    );
  expect(second).toEqual({ draft: first.draft, duplicate: true });
  for (const table of [
    "procurement_catalogue_drafts",
    "source_documents",
    "source_records",
    "local_files",
  ])
    expect(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({
      n: 1,
    });
  expect(await hash(readFileSync(secondPath))).toBe(f.input.checksum);
  expect(await hash(readFileSync(fileURLToPath(f.input.localUri)))).toBe(
    f.input.checksum,
  );
});

it("keeps older as-of imports as separate history; current import time never replaces the tariff date", async () => {
  const f = await setup();
  await f.repo().stage(f.input, () => undefined);
  const older = procurementFixture();
  older.assortment.lastUpdate = "2026-11-20T05:00:00.000Z";
  const bytes = Buffer.from(JSON.stringify(older));
  const path = join(f.dir, "older.json");
  writeFileSync(path, bytes);
  const oldInput = {
    ...f.input,
    ...f.ids(),
    localUri: pathToFileURL(path).href,
    checksum: await hash(bytes),
    importedAt: "2026-11-22T10:00:00.000Z",
  };
  const staged = await f.repo().stage(oldInput, () => undefined);
  expect(staged.draft.catalogue.asOf).toBe(older.assortment.lastUpdate);
  expect(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM procurement_catalogue_drafts")
      .get(),
  ).toEqual({ n: 2 });
  expect(
    (await f.repo().get(f.input.storeId, f.input.ownerId, f.input.checksum))
      ?.catalogue.asOf,
  ).toBe("2026-11-21T05:02:40.133Z");
});

it("rolls back the source, file and records on failed draft insertion or scope change", async () => {
  const f = await setup();
  f.db.exec(
    "CREATE TRIGGER reject_draft BEFORE INSERT ON procurement_catalogue_drafts BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END",
  );
  await expect(f.repo().stage(f.input, () => undefined)).rejects.toThrow(
    "TEST_FAILURE",
  );
  f.db.exec("DROP TRIGGER reject_draft");
  let calls = 0;
  await expect(
    f.repo().stage(f.input, () => {
      if (++calls === 3) throw Error("SCOPE_CHANGED");
    }),
  ).rejects.toThrow("SCOPE_CHANGED");
  for (const table of [
    "procurement_catalogue_drafts",
    "source_documents",
    "source_records",
    "local_files",
  ])
    expect(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({
      n: 0,
    });
  expect(readFileSync(fileURLToPath(f.input.localUri)).length).toBeGreaterThan(
    0,
  );
});

it("rejects changed originals or a different PDV before any local write, and cannot upload a private draft through the legacy store-wide channel", async () => {
  const f = await setup();
  await expect(
    f
      .repo()
      .stage(
        { ...f.input, checksum: "sha256:" + "0".repeat(64) },
        () => undefined,
      ),
  ).rejects.toThrow("PROCUREMENT_SOURCE_CHANGED");
  await expect(
    f.repo().stage({ ...f.input, expectedPdv: "9084" }, () => undefined),
  ).rejects.toThrow("PROCUREMENT_PDV_MISMATCH");
  expect(
    f.db.prepare("SELECT COUNT(*) AS n FROM source_documents").get(),
  ).toEqual({ n: 0 });
  expect(
    initSourceUploadRequestSchema.safeParse({
      sourceDocumentId: f.input.sourceDocumentId,
      sourceType: "PROCUREMENT_CATALOGUE",
      filename: f.input.filename,
      mimeType: "application/json",
      sizeBytes: 100,
      checksum: f.input.checksum,
    }).success,
  ).toBe(false);
});
