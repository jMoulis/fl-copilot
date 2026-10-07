import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type {
  LocalFileMetadata,
  LocalSourceDocument,
  SourceRecord,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  captureCommercialPdf,
  assertPdfHeader,
  type CommercialPdfStorage,
} from "./commercial-pdf-capture";
import { SourceDocumentRepository } from "./source-document-repository";

type SQLiteValue = string | number | null;

class NodeDatabase implements OutboxDatabase, AtomicMutationDatabase {
  constructor(readonly database: DatabaseSync) {}

  async execAsync(sql: string) {
    this.database.exec(sql);
  }

  async getFirstAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return (this.database.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).all(...params) as T[];
  }

  async runAsync(sql: string, ...params: SQLiteValue[]) {
    return this.database.prepare(sql).run(...params);
  }

  async withExclusiveTransactionAsync(
    task: (transaction: OutboxDatabase) => Promise<void>,
  ) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const directories: string[] = [];
const storeId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const fileId = "33333333-3333-4333-8333-333333333333";
const recordId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-09-27T10:00:00.000Z";
const checksum = "sha256:153da55f5f19";

function sourceDocument(
  overrides: Partial<LocalSourceDocument> = {},
): LocalSourceDocument {
  return {
    id: documentId,
    storeId,
    sourceType: "MERCALYS_SALES",
    originalFilename: "ventes-2026-09-26.xlsx",
    localFileUri: "file:///documents/ventes-2026-09-26.xlsx",
    checksum,
    sourceGeneratedAt: null,
    businessPeriodStart: "2026-09-26",
    businessPeriodEnd: "2026-09-26",
    localProcessingStatus: "PENDING",
    remoteUploadStatus: "LOCAL_ONLY",
    remoteProcessingStatus: null,
    parserVersion: null,
    extractionModelVersion: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    syncState: "LOCAL_ONLY",
    remoteVersion: null,
    dirty: true,
    ...overrides,
  };
}

function localFile(
  overrides: Partial<LocalFileMetadata> = {},
): LocalFileMetadata {
  return {
    id: fileId,
    storeId,
    sourceDocumentId: documentId,
    localUri: "file:///documents/ventes-2026-09-26.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 4096,
    checksum,
    retentionStatus: "RETAINED",
    uploadStatus: "LOCAL_ONLY",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function sourceRecord(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: recordId,
    storeId,
    sourceDocumentId: documentId,
    sourceIndex: 0,
    sourcePage: null,
    rawPayload: { itm8: "00001234", netSales: "19.90" },
    normalizedPayload: null,
    status: "RAW",
    errorCodes: [],
    warningCodes: ["DATE_TO_CONFIRM"],
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SourceDocumentRepository", () => {
  it("preserves file metadata, checksum, and raw records across restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-sources-"));
    directories.push(directory);
    const path = join(directory, "local.db");
    const firstDatabase = new DatabaseSync(path);
    const firstAdapter = new NodeDatabase(firstDatabase);
    await runLocalMigrations(firstAdapter);
    const firstRepository = new SourceDocumentRepository(firstAdapter);

    await firstRepository.createWithFile({
      document: sourceDocument(),
      file: localFile(),
    });
    await firstRepository.addRecords([sourceRecord()]);
    firstDatabase.close();

    const reopenedDatabase = new DatabaseSync(path);
    const reopenedAdapter = new NodeDatabase(reopenedDatabase);
    await runLocalMigrations(reopenedAdapter);
    const repository = new SourceDocumentRepository(reopenedAdapter);

    await expect(repository.getDocument(documentId)).resolves.toMatchObject({
      id: documentId,
      checksum,
      localProcessingStatus: "PENDING",
      syncState: "LOCAL_ONLY",
    });
    await expect(
      repository.getFileForDocument(documentId),
    ).resolves.toMatchObject({
      id: fileId,
      localUri: "file:///documents/ventes-2026-09-26.xlsx",
      sizeBytes: 4096,
      checksum,
      retentionStatus: "RETAINED",
    });
    await expect(repository.listRecords(documentId)).resolves.toMatchObject([
      {
        id: recordId,
        rawPayload: { itm8: "00001234", netSales: "19.90" },
        warningCodes: ["DATE_TO_CONFIRM"],
      },
    ]);
    await expect(
      repository.findDocumentByChecksum(storeId, "MERCALYS_SALES", checksum),
    ).resolves.toMatchObject({ id: documentId });

    reopenedDatabase.close();
  });

  it("rolls back the document when its file metadata cannot be inserted", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-sources-"));
    directories.push(directory);
    const database = new DatabaseSync(join(directory, "local.db"));
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);
    database
      .prepare(
        `
          INSERT INTO local_files (
            id, store_id, source_document_id, local_uri, mime_type,
            size_bytes, checksum, retention_status, upload_status,
            created_at, updated_at
          ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        fileId,
        storeId,
        "file:///documents/existing.xlsx",
        "application/octet-stream",
        1,
        "sha256:existing",
        "RETAINED",
        "LOCAL_ONLY",
        timestamp,
        timestamp,
      );
    const repository = new SourceDocumentRepository(adapter);

    await expect(
      repository.createWithFile({
        document: sourceDocument(),
        file: localFile(),
      }),
    ).rejects.toThrow();
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM source_documents").get(),
    ).toEqual({ count: 0 });

    database.close();
  });

  it("rejects a file whose immutable checksum differs from the document", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fl-copilot-sources-"));
    directories.push(directory);
    const database = new DatabaseSync(join(directory, "local.db"));
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);
    const repository = new SourceDocumentRepository(adapter);

    await expect(
      repository.createWithFile({
        document: sourceDocument(),
        file: localFile({ checksum: "sha256:different" }),
      }),
    ).rejects.toThrow("checksums must match");

    database.close();
  });
});

describe("commercial PDF offline capture", () => {
  const pdfChecksum = `sha256:${"a".repeat(64)}`;
  const input = {
    uri: "file:///picker/week.pdf",
    originalFilename: "Semaine 41.pdf",
    mimeType: "application/pdf",
    storeId,
    documentId,
    fileId,
    capturedAt: timestamp,
  };
  async function setup() {
    const directory = mkdtempSync(join(tmpdir(), "fl-commercial-pdf-"));
    directories.push(directory);
    const path = join(directory, "local.db");
    const database = new DatabaseSync(path);
    const adapter = new NodeDatabase(database);
    await runLocalMigrations(adapter);
    const removed: string[] = [];
    const copies: string[] = [];
    const storage: CommercialPdfStorage = {
      async persist({ uri, filename }) {
        expect(uri).toBe(input.uri);
        const localUri = `file:///documents/commercial-pdfs/${filename}`;
        copies.push(localUri);
        return { localUri, sizeBytes: 42, checksum: pdfChecksum };
      },
      async remove(uri) {
        removed.push(uri);
      },
    };
    return {
      database,
      path,
      storage,
      removed,
      copies,
      repository: new SourceDocumentRepository(adapter),
    };
  }
  it("keeps the source and metadata after restart, leaves dates unknown and does not create business data or a premature upload job", async () => {
    const { database, path, repository, storage, removed } = await setup();
    await captureCommercialPdf(input, repository, storage);
    expect(removed).toEqual([]);
    expect(database.prepare("SELECT * FROM local_jobs").all()).toEqual([]);
    expect(database.prepare("SELECT * FROM sync_outbox").all()).toEqual([]);
    expect(database.prepare("SELECT * FROM source_records").all()).toEqual([]);
    database.close();
    const reopened = new DatabaseSync(path);
    const restored = new SourceDocumentRepository(new NodeDatabase(reopened));
    expect(
      await restored.listDocuments(storeId, "WEEKLY_COMMERCIAL_PDF"),
    ).toMatchObject([
      {
        id: documentId,
        originalFilename: "Semaine 41.pdf",
        localProcessingStatus: "PENDING",
        remoteUploadStatus: "LOCAL_ONLY",
        businessPeriodStart: null,
        businessPeriodEnd: null,
      },
    ]);
    expect(await restored.getFileForDocument(documentId)).toMatchObject({
      checksum: pdfChecksum,
      mimeType: "application/pdf",
      retentionStatus: "RETAINED",
      localUri: `file:///documents/commercial-pdfs/${fileId}.pdf`,
    });
    expect(
      await restored.listDocuments(recordId, "WEEKLY_COMMERCIAL_PDF"),
    ).toEqual([]);
    reopened.close();
  });
  it("keeps one source for exact duplicate content, while a changed PDF keeps its own immutable source", async () => {
    const { database, repository, storage, removed } = await setup();
    const first = await captureCommercialPdf(input, repository, storage);
    const duplicate = await captureCommercialPdf(
      {
        ...input,
        documentId: recordId,
        fileId: recordId,
        originalFilename: "renamed.pdf",
      },
      repository,
      storage,
    );
    expect(duplicate).toMatchObject({
      duplicate: true,
      document: { id: first.document.id },
    });
    expect(removed).toEqual([
      `file:///documents/commercial-pdfs/${recordId}.pdf`,
    ]);
    expect(
      await repository.listDocuments(storeId, "WEEKLY_COMMERCIAL_PDF"),
    ).toHaveLength(1);
    const changed = await captureCommercialPdf(
      { ...input, documentId: recordId, fileId: recordId },
      repository,
      {
        ...storage,
        async persist(args) {
          const file = await storage.persist(args);
          return { ...file, checksum: `sha256:${"b".repeat(64)}` };
        },
      },
    );
    expect(changed.duplicate).toBe(false);
    expect(
      await repository.listDocuments(storeId, "WEEKLY_COMMERCIAL_PDF"),
    ).toHaveLength(2);
    expect((await repository.getDocument(documentId))?.checksum).toBe(
      pdfChecksum,
    );
    database.close();
  });
  it("rolls back file metadata failure and removes only the new copy, never the selected original", async () => {
    const { database, repository, storage, removed } = await setup();
    database.exec(
      "CREATE TRIGGER fail_pdf_file BEFORE INSERT ON local_files BEGIN SELECT RAISE(ABORT, 'FILE_METADATA_FAILURE'); END",
    );
    await expect(
      captureCommercialPdf(input, repository, storage),
    ).rejects.toThrow("FILE_METADATA_FAILURE");
    expect(
      await repository.listDocuments(storeId, "WEEKLY_COMMERCIAL_PDF"),
    ).toEqual([]);
    expect(removed).toEqual([
      `file:///documents/commercial-pdfs/${fileId}.pdf`,
    ]);
    expect(removed).not.toContain(input.uri);
    database.close();
  });
  it("rejects non-PDF selections, empty files and invalid checksums before saving a source", async () => {
    const { database, repository, storage, copies, removed } = await setup();
    await expect(
      captureCommercialPdf(
        { ...input, mimeType: "image/jpeg" },
        repository,
        storage,
      ),
    ).rejects.toThrow("COMMERCIAL_PDF_INVALID");
    expect(copies).toEqual([]);
    await expect(
      captureCommercialPdf(input, repository, {
        ...storage,
        async persist(args) {
          return { ...(await storage.persist(args)), sizeBytes: 0 };
        },
      }),
    ).rejects.toThrow("COMMERCIAL_PDF_SIZE_INVALID");
    await expect(
      captureCommercialPdf(input, repository, {
        ...storage,
        async persist(args) {
          return { ...(await storage.persist(args)), checksum: "invalid" };
        },
      }),
    ).rejects.toThrow();
    expect(removed).toHaveLength(2);
    expect(
      await repository.listDocuments(storeId, "WEEKLY_COMMERCIAL_PDF"),
    ).toEqual([]);
    database.close();
  });
  it("checks actual PDF header bytes instead of trusting a filename", () => {
    expect(() =>
      assertPdfHeader(new TextEncoder().encode("%PDF-1.7\n1 0 obj")),
    ).not.toThrow();
    expect(() =>
      assertPdfHeader(new TextEncoder().encode("renamed spreadsheet.xlsx")),
    ).toThrow("COMMERCIAL_PDF_INVALID");
    expect(() => assertPdfHeader(new Uint8Array())).toThrow(
      "COMMERCIAL_PDF_INVALID",
    );
  });
});
