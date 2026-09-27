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
