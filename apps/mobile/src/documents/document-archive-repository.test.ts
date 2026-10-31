import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { documentArchiveFixture } from "../../../../scripts/test-document-archive-fixtures";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import {
  DocumentArchiveRepository,
  applyDocumentArchive,
} from "./document-archive-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { localMigrations, runLocalMigrations } from "../db/migrations";
import { SourceDocumentRepository } from "./source-document-repository";

const preserved = [
  "source_documents",
  "local_files",
  "source_records",
  "sales_observations",
  "waste_observations",
  "waste_receipts",
  "waste_lines",
  "mercalys_intake_batches",
  "mercalys_intake_items",
  "commercial_offer_choices",
  "local_jobs",
];
type Fixture = Awaited<ReturnType<typeof documentArchiveFixture>>;
const snapshot = (s: Fixture) =>
  preserved.map((t) => s.db.prepare("SELECT * FROM " + t).all());
const commands = (s: Fixture) =>
  s.db
    .prepare(
      "SELECT * FROM sync_outbox WHERE entity_type='document_archive' ORDER BY local_sequence",
    )
    .all();

it("archives/restores offline across restart without changing sources, figures, jobs or duplicate detection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-archive-")),
    path = join(dir, "db.sqlite"),
    s = await documentArchiveFixture(path);
  try {
    const before = snapshot(s);
    await s.archives.set(
      s.document.id,
      "COMMERCIAL_DOCUMENT",
      true,
      s.context(),
    );
    expect(snapshot(s)).toEqual(before);
    const source = await s.sources.getDocument(s.document.id),
      file = await s.sources.getFileForDocument(s.document.id);
    const id = randomUUID();
    expect(
      (
        await s.sources.createCommercialPdf({
          document: { ...source!, id },
          file: { ...file!, id: randomUUID(), sourceDocumentId: id },
        })
      ).duplicate,
    ).toBe(true);
    s.db.close();
    const db = new DatabaseSync(path),
      a = new ReceiptTestDatabase(db);
    try {
      const restored = new DocumentArchiveRepository(a, s.scope);
      expect(await restored.list()).toMatchObject([
        { id: s.document.id, archived: true },
      ]);
      await restored.set(
        s.document.id,
        "COMMERCIAL_DOCUMENT",
        false,
        s.context(),
      );
      expect(await restored.list()).toMatchObject([{ archived: false }]);
      expect(
        preserved.map((t) => db.prepare("SELECT * FROM " + t).all()),
      ).toEqual(before);
      const pending = await new OutboxRepository(a).listPending(
        s.scope.storeId,
      );
      expect(
        pending.filter((c) => c.entityType === "document_archive"),
      ).toHaveLength(1);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) n FROM sync_outbox WHERE last_error_code='DOCUMENT_ARCHIVE_SUPERSEDED'",
          )
          .get()!.n,
      ).toBe(1);
    } finally {
      db.close();
    }
  } finally {
    try {
      s.db.close();
    } catch {
      /* reopened */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps a newer restore while an older archive acknowledgement and pull arrive", async () => {
  const s = await documentArchiveFixture();
  try {
    const first = s.context();
    await s.archives.set(s.document.id, "COMMERCIAL_DOCUMENT", true, first);
    await new OutboxRepository(s.a).markSyncing(first.commandId);
    const second = s.context();
    await s.archives.set(s.document.id, "COMMERCIAL_DOCUMENT", false, second);
    const archive = {
      ...(await s.archives.list())[0]!,
      archived: true,
      version: 1,
    };
    await applyDocumentArchive(s.a, s.scope, archive, first.commandId);
    expect(await s.archives.list()).toMatchObject([{ archived: false }]);
    // A later explicit action on another device wins by server commit order.
    await applyDocumentArchive(s.a, s.scope, { ...archive, version: 3 });
    expect(await s.archives.list()).toMatchObject([{ archived: false }]);
    await applyDocumentArchive(
      s.a,
      s.scope,
      { ...archive, archived: false, version: 2 },
      second.commandId,
    );
    expect(await s.archives.list()).toMatchObject([
      { archived: true, version: 3 },
    ]);
    expect(
      s.db.prepare("SELECT pending_command_id FROM document_archives").get()!
        .pending_command_id,
    ).toBeNull();
  } finally {
    s.db.close();
  }
});

it.each(["BEFORE", "DURING", "COMMIT"] as const)(
  "rolls back archive metadata and its command together (%s)",
  async (mode) => {
    const s = await documentArchiveFixture();
    try {
      let allowed = mode !== "BEFORE";
      if (mode === "DURING")
        s.a.afterRun = (sql) => {
          if (sql.startsWith("INSERT INTO document_archives")) allowed = false;
        };
      if (mode === "COMMIT") s.a.fail = true;
      const before = snapshot(s);
      await expect(
        s.archives.set(s.document.id, "COMMERCIAL_DOCUMENT", true, {
          ...s.context(),
          canWrite: () => allowed,
        }),
      ).rejects.toThrow();
      expect(await s.archives.list()).toEqual([]);
      expect(commands(s)).toEqual([]);
      expect(snapshot(s)).toEqual(before);
    } finally {
      s.db.close();
    }
  },
);

it("isolates owners, rejects unknown local targets and foreign remote metadata", async () => {
  const s = await documentArchiveFixture();
  try {
    await expect(
      s.archives.set(randomUUID(), "COMMERCIAL_DOCUMENT", true, s.context()),
    ).rejects.toThrow("TARGET_UNAVAILABLE");
    const foreign = new DocumentArchiveRepository(s.a, {
      ...s.scope,
      ownerId: randomUUID(),
    });
    await expect(
      foreign.set(s.batch.id, "MERCALYS_BATCH", true, s.context()),
    ).rejects.toThrow("TARGET_UNAVAILABLE");
    await s.archives.set(
      s.document.id,
      "COMMERCIAL_DOCUMENT",
      true,
      s.context(),
    );
    expect(await foreign.list()).toEqual([]);
    await expect(
      applyDocumentArchive(s.a, s.scope, {
        ...(await s.archives.list())[0]!,
        ownerId: randomUUID(),
      }),
    ).rejects.toThrow("SCOPE_INVALID");
    expect(
      await new OutboxRepository(s.a).listFailures(
        s.scope.storeId,
        randomUUID(),
      ),
    ).toMatchObject({ items: [] });
  } finally {
    s.db.close();
  }
});

it("filters individual batch files before pagination while retaining the complete processor working set", async () => {
  const s = await documentArchiveFixture(":memory:", 100);
  try {
    const before = snapshot(s);
    for (const file of s.batch.files.slice(0, 85))
      await s.archives.set(file.id, "MERCALYS_ITEM", true, s.context());
    const active = await s.batches.page(s.batch.id, -1, 20, false);
    expect(active.items.map((f) => f.position)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 85),
    );
    expect(active.hasMore).toBe(false);
    expect((await s.batches.page(s.batch.id, -1, 20, true)).items).toHaveLength(
      20,
    );
    expect(
      (await s.batches.page(s.batch.id)).items.map((f) => f.position),
    ).toEqual(Array.from({ length: 20 }, (_, i) => i));
    await s.archives.set(s.batch.id, "MERCALYS_BATCH", true, s.context());
    expect((await s.batches.recent(undefined, false)).batches).toHaveLength(0);
    expect((await s.batches.recent(undefined, true)).batches).toHaveLength(1);
    expect(snapshot(s)).toEqual(before);
  } finally {
    s.db.close();
  }
});

it("retains 300 explicit intents without accumulating active superseded commands or rewriting business tables", async () => {
  const s = await documentArchiveFixture();
  try {
    const before = snapshot(s),
      outbox = new OutboxRepository(s.a);
    for (let i = 0; i < 300; i++)
      await s.archives.set(
        s.document.id,
        "COMMERCIAL_DOCUMENT",
        i % 2 === 0,
        s.context(),
      );
    expect(commands(s)).toHaveLength(300);
    expect(
      (await outbox.listPending(s.scope.storeId)).filter(
        (c) => c.entityType === "document_archive",
      ),
    ).toHaveLength(1);
    expect(
      (
        await outbox.listFailures(s.scope.storeId, s.scope.ownerId)
      ).items.filter((c) => c.entityType === "document_archive"),
    ).toHaveLength(0);
    expect(snapshot(s)).toEqual(before);
  } finally {
    s.db.close();
  }
});

it("does not let another account’s 100 pending archive commands starve the active account", async () => {
  const s = await documentArchiveFixture(":memory:", 100);
  try {
    for (const f of s.batch.files)
      await s.archives.set(f.id, "MERCALYS_ITEM", true, s.context());
    const ownerId = randomUUID(),
      other = new DocumentArchiveRepository(s.a, {
        storeId: s.scope.storeId,
        ownerId,
      });
    await other.set(s.document.id, "COMMERCIAL_DOCUMENT", true, s.context());
    const page = await new OutboxRepository(s.a).listPending(
      s.scope.storeId,
      100,
      ownerId,
    );
    expect(
      page.filter((c) => c.entityType === "document_archive"),
    ).toHaveLength(1);
    expect(
      page.find((c) => c.entityType === "document_archive")?.payload,
    ).toMatchObject({ ownerId });
  } finally {
    s.db.close();
  }
});

it("upgrades an existing v61 installation without changing original files, pending work or visibility", async () => {
  const fixture = await documentArchiveFixture(),
    db = new DatabaseSync(":memory:"),
    a = new ReceiptTestDatabase(db);
  try {
    await runLocalMigrations(
      a,
      localMigrations.filter((m) => m.version <= 61),
    );
    const file = (await fixture.sources.getFileForDocument(
      fixture.document.id,
    ))!;
    await new SourceDocumentRepository(a).createCommercialPdf({
      document: fixture.document,
      file,
    });
    const tables = [
      "source_documents",
      "local_files",
      "local_jobs",
      "sync_outbox",
    ];
    const before = tables.map((t) => db.prepare("SELECT * FROM " + t).all());
    await runLocalMigrations(a);
    expect(tables.map((t) => db.prepare("SELECT * FROM " + t).all())).toEqual(
      before,
    );
    expect(
      await new DocumentArchiveRepository(a, fixture.scope).list(),
    ).toEqual([]);
  } finally {
    db.close();
    fixture.db.close();
  }
});
