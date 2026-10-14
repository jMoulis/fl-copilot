import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  mercalysBatchInputSchema,
  MAX_MERCALYS_BATCH_FILE_BYTES,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { runLocalMigrations } from "../db/migrations";
import { MercalysBatchRepository } from "./mercalys-batch-repository";
import { MercalysBatchPreparation } from "./mercalys-batch-preparation";
class Adapter implements OutboxDatabase {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: (string | number | null)[]) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: (string | number | null)[]) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: (string | number | null)[]) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async withExclusiveTransactionAsync(
    work: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await work(this);
      if (this.fail) throw Error("COMMIT_FAILED");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
const dirs: string[] = [],
  databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) {
    try {
      db.close();
    } catch {
      /* Already closed for reopen test. */
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function setup(count = 25) {
  const dir = mkdtempSync(join(tmpdir(), "fl-batch-"));
  dirs.push(dir);
  const path = join(dir, "batch.db");
  const db = new DatabaseSync(path);
  databases.push(db);
  const adapter = new Adapter(db);
  await runLocalMigrations(adapter);
  const scope = { storeId: randomUUID(), ownerId: randomUUID() };
  const input = mercalysBatchInputSchema.parse({
    id: randomUUID(),
    ...scope,
    conversationId: null,
    createdAt: "2026-10-14T12:00:00Z",
    files: Array.from({ length: count }, (_, i) => ({
      id: randomUUID(),
      filename: `${i}.xlsx`,
      localUri: `file:///owned/${i}.xlsx`,
      sizeBytes: 1,
      checksum: `sha256:${"a".repeat(64)}`,
    })),
  });
  return {
    db,
    adapter,
    path,
    scope,
    input,
    repo: new MercalysBatchRepository(adapter, scope),
  };
}
it("persists more than ten source items, paginates, restores and scopes preparation without Outbox publication", async () => {
  const s = await setup();
  await s.repo.create(s.input);
  await s.repo.create(s.input);
  const first = await s.repo.page(s.input.id);
  expect(first.items).toHaveLength(20);
  expect(first.hasMore).toBe(true);
  const second = await s.repo.page(s.input.id, first.after);
  expect(second.items).toHaveLength(5);
  expect(second.hasMore).toBe(false);
  await s.repo.finish(s.input.id, s.input.files[0]!.id, 1, {
    status: "FAILED",
    code: "FORMAT_UNRECOGNIZED",
  });
  s.db.close();
  const reopened = new DatabaseSync(s.path);
  databases.push(reopened);
  const restored = new MercalysBatchRepository(new Adapter(reopened), s.scope);
  expect(
    (await restored.get(s.input.id, s.input.files[0]!.id)).result.status,
  ).toBe("FAILED");
  await expect(
    new MercalysBatchRepository(new Adapter(reopened), {
      ...s.scope,
      ownerId: randomUUID(),
    }).page(s.input.id),
  ).rejects.toThrow("MERCALYS_BATCH_UNAVAILABLE");
  expect(
    reopened.prepare("SELECT count(*) AS n FROM sync_outbox").get(),
  ).toEqual({ n: 0 });
});
it("rolls back whole manifests and prevents identity reuse, changed-item results and unowned chat binding", async () => {
  const s = await setup(2);
  s.adapter.fail = true;
  await expect(s.repo.create(s.input)).rejects.toThrow("COMMIT_FAILED");
  s.adapter.fail = false;
  expect(
    s.db.prepare("SELECT count(*) AS n FROM mercalys_intake_items").get(),
  ).toEqual({ n: 0 });
  await expect(
    s.repo.create({ ...s.input, conversationId: randomUUID() }),
  ).rejects.toThrow("MERCALYS_BATCH_CONVERSATION_INVALID");
  await s.repo.create(s.input);
  await expect(
    s.repo.create({
      ...s.input,
      files: [
        { ...s.input.files[0]!, filename: "Changed.xlsx" },
        s.input.files[1]!,
      ],
    }),
  ).rejects.toThrow("MERCALYS_BATCH_ID_REUSED");
  const id = s.input.files[0]!.id;
  await s.repo.finish(s.input.id, id, 1, { status: "FAILED", code: "ERROR" });
  await expect(
    s.repo.finish(s.input.id, id, 1, { status: "QUEUED" }),
  ).rejects.toThrow("MERCALYS_BATCH_ITEM_CHANGED");
});
it("isolates malformed files, verifies immutable bytes, prepares both channels, retries failures and preserves cancelled work", async () => {
  const s = await setup(4);
  const bytes = [
    new Uint8Array([1]),
    workbook("Vente Nette"),
    workbook("Casse"),
    workbook("Vente Nette"),
  ];
  s.input.files = s.input.files.map((f, i) => ({
    ...f,
    sizeBytes: bytes[i]!.byteLength,
    checksum: checksum(bytes[i]!),
  }));
  await s.repo.create(s.input);
  const read = vi.fn(
    async (uri: string) => bytes[Number(uri.match(/(\d+)\.xlsx/)![1])]!,
  );
  const duplicate = vi.fn(async () => null),
    overlap = vi.fn(async () => null);
  const service = new MercalysBatchPreparation(s.repo, {
    read,
    checksum: async (b) => checksum(b),
    catalog: async () => ({ products: [], identifiers: [], aliases: [] }),
    publication: { findExactDuplicate: duplicate, analyzeOverlap: overlap },
  });
  await service.preparePending(s.input.id);
  const items = (await s.repo.page(s.input.id)).items;
  expect(items.map((i) => i.result.status)).toEqual([
    "FAILED",
    "REVIEW",
    "REVIEW",
    "REVIEW",
  ]);
  expect(items[1]!.result).toMatchObject({
    sourceType: "MERCALYS_SALES",
    productReviewCount: 1,
    readyCount: 0,
  });
  expect(items[2]!.result).toMatchObject({ sourceType: "MERCALYS_WASTE" });
  const previousRead = read.mock.calls.length;
  await service.preparePending(s.input.id);
  expect(read.mock.calls.length).toBe(previousRead + 1);
  bytes[0] = new Uint8Array([2]);
  await service.prepare(s.input.id, s.input.files[0]!.id);
  expect((await s.repo.get(s.input.id, s.input.files[0]!.id)).result).toEqual({
    status: "FAILED",
    code: "MERCALYS_BATCH_FILE_CHANGED",
  });
  const abort = new AbortController();
  abort.abort();
  const before = (await s.repo.get(s.input.id, s.input.files[0]!.id)).version;
  await expect(
    service.preparePending(s.input.id, abort.signal),
  ).rejects.toThrow("MERCALYS_BATCH_CANCELLED");
  expect((await s.repo.get(s.input.id, s.input.files[0]!.id)).version).toBe(
    before,
  );
});
it("rejects authority flags, duplicate item IDs and aggregate size overflow before creating a batch", async () => {
  const s = await setup(6);
  expect(
    mercalysBatchInputSchema.safeParse({ ...s.input, allowPublish: true })
      .success,
  ).toBe(false);
  expect(
    mercalysBatchInputSchema.safeParse({
      ...s.input,
      files: [s.input.files[0], s.input.files[0]],
    }).success,
  ).toBe(false);
  expect(
    mercalysBatchInputSchema.safeParse({
      ...s.input,
      files: s.input.files.map((f) => ({
        ...f,
        sizeBytes: MAX_MERCALYS_BATCH_FILE_BYTES,
      })),
    }).success,
  ).toBe(false);
});
function checksum(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function workbook(flow: string): Uint8Array<ArrayBuffer> {
  const rows = [
    ["Edition du 28/09/2026 à 12:00:00"],
    [
      `Statistique : Entrées / Sorties: Niveau de détail: Par Article, Détail Période: non détaillée, Flux: ${flow}, Type valorisation: PA`,
    ],
    [],
    ["Sélection de données : Du 26/09/2026 Au 26/09/2026"],
    ["Critères de sélection :"],
    ["Nomenclature : Du 20343400 à 20343402"],
    [],
    [
      "ITM8 Prio",
      "EAN Prio",
      "Libellé",
      "Quantité",
      "Valeur prix achat",
      "Valeur RCE",
      "Valeur prix vente",
      "Valeur TVA",
      "Val Marge",
      "% Marge",
    ],
    ["00000001", "0000000000001", "Article", 1, 1, 0, 2, 0.1, 0.9, 45],
    ["", "", "", 1, 1, 0, 2, 0.1, 0.9, 45],
    [],
    ["Nombre de Lignes : 1"],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Mercalys");
  return new Uint8Array(
    XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
  );
}
it("records an exact existing duplicate without overlap or publication, and rolls back a failed result commit", async () => {
  const s = await setup(1),
    bytes = workbook("Vente Nette"),
    sourceId = randomUUID();
  s.input.files = [
    {
      ...s.input.files[0]!,
      sizeBytes: bytes.byteLength,
      checksum: checksum(bytes),
    },
  ];
  await s.repo.create(s.input);
  const overlap = vi.fn(async () => null);
  const service = new MercalysBatchPreparation(s.repo, {
    read: async () => bytes,
    checksum: async (b) => checksum(b),
    catalog: async () => ({ products: [], identifiers: [], aliases: [] }),
    publication: {
      analyzeOverlap: overlap,
      findExactDuplicate: async () => ({
        sourceDocumentId: sourceId,
        sourceType: "MERCALYS_SALES",
        originalFilename: "Existing.xlsx",
        businessPeriodStart: "2026-09-26",
        businessPeriodEnd: "2026-09-26",
        localProcessingStatus: "PUBLISHED",
        remoteProcessingStatus: null,
        createdAt: s.input.createdAt,
      }),
    },
  });
  s.adapter.fail = true;
  await expect(service.preparePending(s.input.id)).rejects.toThrow(
    "COMMIT_FAILED",
  );
  s.adapter.fail = false;
  expect(
    (await s.repo.get(s.input.id, s.input.files[0]!.id)).result.status,
  ).toBe("QUEUED");
  await service.preparePending(s.input.id);
  expect((await s.repo.get(s.input.id, s.input.files[0]!.id)).result).toEqual({
    status: "DUPLICATE",
    sourceDocumentId: sourceId,
    sourceType: "MERCALYS_SALES",
  });
  expect(overlap).not.toHaveBeenCalled();
  expect(
    s.db.prepare("SELECT count(*) AS n FROM sales_observations").get(),
  ).toEqual({ n: 0 });
});
it("retains successful file copies despite sibling failure and records a cancelled copied prefix before restart", async () => {
  const { captureMercalysBatch } = await import("./mercalys-batch-capture");
  const s = await setup(1),
    copies: string[] = [];
  const storage = {
    size: async () => 1,
    retain: async (uri: string, id: string) => {
      if (uri.endsWith("bad")) throw Error("NO_COPY");
      copies.push(uri);
      return {
        localUri: `file:///owned/${id}.xlsx`,
        sizeBytes: 1,
        checksum: `sha256:${"a".repeat(64)}`,
      };
    },
  };
  const input = {
    storeId: s.scope.storeId,
    ownerId: s.scope.ownerId,
    files: [
      { name: "good.xlsx", uri: "file:///good" },
      { name: "bad.xlsx", uri: "file:///bad" },
    ],
  };
  const captured = await captureMercalysBatch(
    input,
    s.repo,
    storage,
    randomUUID,
  );
  expect(captured.failures).toEqual(["bad.xlsx"]);
  expect(
    (await s.repo.page(captured.batchId!)).items.map((i) => i.filename),
  ).toEqual(["good.xlsx"]);
  const abort = new AbortController();
  await expect(
    captureMercalysBatch(
      { ...input, files: [input.files[0]!, input.files[0]!] },
      s.repo,
      storage,
      randomUUID,
      abort.signal,
      () => abort.abort(),
    ),
  ).rejects.toThrow("MERCALYS_BATCH_CANCELLED");
  const recent = await s.repo.recent();
  expect(recent.batches).toHaveLength(2);
  expect(recent.batches.every((b) => b.files.length === 1)).toBe(true);
  expect(copies).toHaveLength(2);
  const retain = vi.fn(storage.retain);
  await expect(
    captureMercalysBatch(
      { ...input, files: Array.from({ length: 101 }, () => input.files[0]!) },
      s.repo,
      { ...storage, retain },
      randomUUID,
    ),
  ).rejects.toThrow("MERCALYS_BATCH_LIMIT");
  expect(retain).not.toHaveBeenCalled();
});
it("allows explicit rechecking without overwriting a concurrent item result", async () => {
  const s = await setup(1);
  await s.repo.create(s.input);
  const file = s.input.files[0]!;
  await s.repo.finish(s.input.id, file.id, 1, {
    status: "DUPLICATE",
    sourceDocumentId: randomUUID(),
    sourceType: "MERCALYS_SALES",
  });
  await s.repo.refresh(s.input.id, file.id, 2);
  expect((await s.repo.get(s.input.id, file.id)).result.status).toBe("QUEUED");
  await expect(s.repo.refresh(s.input.id, file.id, 2)).rejects.toThrow(
    "MERCALYS_BATCH_ITEM_CHANGED",
  );
});
it("paginates recent lots with identical timestamps and rejects foreign capture before copying", async () => {
  const { captureMercalysBatch } = await import("./mercalys-batch-capture");
  const s = await setup(1);
  for (let n = 0; n < 12; n++)
    await s.repo.create({
      ...s.input,
      id: randomUUID(),
      files: [{ ...s.input.files[0]!, id: randomUUID() }],
    });
  const first = await s.repo.recent(),
    last = first.batches.at(-1)!;
  const next = await s.repo.recent({ id: last.id, createdAt: last.createdAt });
  expect(first.hasMore).toBe(true);
  expect(next.hasMore).toBe(false);
  expect(
    new Set([...first.batches, ...next.batches].map((b) => b.id)).size,
  ).toBe(12);
  const retain = vi.fn();
  await expect(
    captureMercalysBatch(
      {
        storeId: s.scope.storeId,
        ownerId: randomUUID(),
        files: [{ name: "File.xlsx", uri: "file:///selected" }],
      },
      s.repo,
      { size: async () => 1, retain },
      randomUUID,
    ),
  ).rejects.toThrow("MERCALYS_BATCH_SCOPE_INVALID");
  expect(retain).not.toHaveBeenCalled();
});
it("retains ZIP lineage, retries missing copies without duplicating reviewed children, and scopes the original", async () => {
  const { zipSync } = await import("fflate"),
    { MercalysArchiveRepository } =
      await import("./mercalys-archive-repository"),
    { retainMercalysZip, extractRetainedMercalysZip } =
      await import("./mercalys-zip-capture");
  const s = await setup(1),
    archives = new MercalysArchiveRepository(s.adapter, s.scope),
    raw = new Uint8Array(
      zipSync({
        "sales.xlsx": workbook("Vente Nette"),
        "waste.xlsx": workbook("Casse"),
      }),
    );
  const files = new Map<string, Uint8Array<ArrayBuffer>>(),
    ids = new Map<string, string>(),
    paths = new Map<string, string>();
  let fail = true;
  const storage = {
    retain: async (_uri: string, id: string) => {
      const localUri = `file:///archives/${id}.zip`;
      files.set(localUri, raw);
      return { localUri, sizeBytes: raw.length, checksum: checksum(raw) };
    },
    read: async (uri: string) => new Uint8Array(files.get(uri)!),
    checksum: async (bytes: Uint8Array) => checksum(bytes),
    memberId: async (parent: string, path: string) => {
      const key = `${parent}/${path}`;
      if (!ids.has(key)) ids.set(key, randomUUID());
      const id = ids.get(key)!;
      paths.set(id, path);
      return id;
    },
    member: async (bytes: Uint8Array<ArrayBuffer>, id: string) => {
      if (paths.get(id) === "waste.xlsx" && fail) throw Error("DISK_FULL");
      const localUri = `file:///members/${id}.xlsx`;
      files.set(localUri, bytes);
      return { localUri, sizeBytes: bytes.length, checksum: checksum(bytes) };
    },
    pause: async () => {},
  };
  const id = await retainMercalysZip(
    { name: "Exports.zip", uri: "file:///selected" },
    archives,
    storage,
    randomUUID,
  );
  const first = await extractRetainedMercalysZip(id, archives, s.repo, storage);
  expect(first.outcome).toMatchObject({
    status: "PROCESSED",
    retainedCount: 1,
    failures: [{ path: "waste.xlsx", code: "MERCALYS_ZIP_COPY_FAILED" }],
  });
  const initial = (await s.repo.page(first.batchId)).items[0]!;
  await s.repo.finish(first.batchId, initial.id, 1, {
    status: "FAILED",
    code: "PRESERVED_REVIEW",
  });
  fail = false;
  const resumed = await extractRetainedMercalysZip(
    id,
    archives,
    s.repo,
    storage,
  );
  expect(resumed.outcome).toMatchObject({ retainedCount: 2, failures: [] });
  const page = await s.repo.page(first.batchId);
  expect(page.items).toHaveLength(2);
  expect(page.items[0]).toMatchObject({
    id: initial.id,
    version: 2,
    result: { code: "PRESERVED_REVIEW" },
  });
  await extractRetainedMercalysZip(id, archives, s.repo, storage);
  expect((await s.repo.page(first.batchId)).items).toHaveLength(2);
  await expect(
    new MercalysArchiveRepository(s.adapter, {
      ...s.scope,
      ownerId: randomUUID(),
    }).get(id),
  ).rejects.toThrow("MERCALYS_ARCHIVE_UNAVAILABLE");
  files.set(first.localUri, new Uint8Array([1]));
  expect(
    (await extractRetainedMercalysZip(id, archives, s.repo, storage)).outcome,
  ).toEqual({ status: "FAILED", code: "MERCALYS_ARCHIVE_FILE_CHANGED" });
  expect(s.db.prepare("SELECT count(*) AS n FROM sync_outbox").get()).toEqual({
    n: 0,
  });
});
it("records a retained archive and copied prefix when extraction is interrupted, then appends only remaining stable IDs", async () => {
  const { zipSync } = await import("fflate"),
    { MercalysArchiveRepository } =
      await import("./mercalys-archive-repository"),
    { retainMercalysZip, extractRetainedMercalysZip } =
      await import("./mercalys-zip-capture");
  const s = await setup(1),
    archives = new MercalysArchiveRepository(s.adapter, s.scope),
    raw = new Uint8Array(
      zipSync({
        "a.xlsx": new Uint8Array([1, 2]),
        "b.xlsx": new Uint8Array([3, 4]),
      }),
    ),
    ids = new Map<string, string>(),
    abort = new AbortController();
  let interrupt = true;
  const storage = {
    retain: async (_uri: string, id: string) => ({
      localUri: `file:///archives/${id}.zip`,
      sizeBytes: raw.length,
      checksum: checksum(raw),
    }),
    read: async () => raw,
    checksum: async (b: Uint8Array) => checksum(b),
    memberId: async (_parent: string, path: string) => {
      if (!ids.has(path)) ids.set(path, randomUUID());
      return ids.get(path)!;
    },
    member: async (b: Uint8Array<ArrayBuffer>, id: string) => {
      if (interrupt) abort.abort();
      return {
        localUri: `file:///members/${id}.xlsx`,
        sizeBytes: b.length,
        checksum: checksum(b),
      };
    },
    pause: async () => {},
  };
  const id = await retainMercalysZip(
    { name: "Batch.zip", uri: "file:///selected" },
    archives,
    storage,
    randomUUID,
  );
  await expect(
    extractRetainedMercalysZip(id, archives, s.repo, storage, abort.signal),
  ).rejects.toThrow("MERCALYS_ZIP_CANCELLED");
  const record = await archives.get(id);
  expect(record.outcome.status).toBe("RETAINED");
  expect((await s.repo.page(record.batchId)).items).toHaveLength(1);
  interrupt = false;
  await extractRetainedMercalysZip(id, archives, s.repo, storage);
  expect((await s.repo.page(record.batchId)).items).toHaveLength(2);
  s.db.close();
  const reopened = new DatabaseSync(s.path);
  databases.push(reopened);
  expect(
    (
      await new MercalysArchiveRepository(new Adapter(reopened), s.scope).get(
        id,
      )
    ).outcome,
  ).toMatchObject({ status: "PROCESSED", retainedCount: 2 });
});
it("checks immutable archive metadata on replay and refuses parent binding from another owner", async () => {
  const { MercalysArchiveRepository } =
      await import("./mercalys-archive-repository"),
    s = await setup(1),
    repo = new MercalysArchiveRepository(s.adapter, s.scope);
  const input = {
    id: randomUUID(),
    batchId: randomUUID(),
    ...s.scope,
    filename: "Original.zip",
    localUri: "file:///archive.zip",
    sizeBytes: 10,
    checksum: `sha256:${"a".repeat(64)}`,
    createdAt: s.input.createdAt,
  };
  await repo.create(input);
  await repo.create(input);
  await expect(
    s.repo.appendArchive({
      ...s.input,
      id: input.batchId,
      archiveId: input.id,
      ownerId: randomUUID(),
    }),
  ).rejects.toThrow("MERCALYS_ARCHIVE_SCOPE_INVALID");
  await s.adapter.runAsync(
    "UPDATE mercalys_intake_archives SET payload_json=json_set(payload_json,'$.localUri',?) WHERE id=?",
    "file:///other.zip",
    input.id,
  );
  await expect(repo.get(input.id)).rejects.toThrow(
    "MERCALYS_ARCHIVE_SCOPE_INVALID",
  );
});
