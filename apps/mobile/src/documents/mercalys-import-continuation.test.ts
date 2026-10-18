import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { readCopilotImportStatus } from "@fl-copilot/domain";
import { partialChatImportFixture } from "../../../../scripts/test-chat-import-fixtures";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import {
  MercalysTestDatabase,
  mercalysLocalFixture,
} from "../../../../scripts/test-mercalys-sync-fixtures";
import { CopilotMercalysImportController } from "../copilot/mercalys-import-controller";
import { OutboxRepository } from "../sync/outbox-repository";
import { MercalysImportPublicationRepository } from "./mercalys-import-publication";
import {
  applyMercalysPublication,
  readMercalysPublication,
  repairMercalysPublications,
} from "./mercalys-publication-sync";
const table = (flow: string) =>
  flow === "MERCALYS_SALES" ? "sales_observations" : "waste_observations";
const allPackets = (s: Awaited<ReturnType<typeof partialChatImportFixture>>) =>
  s.a.getAllAsync<{
    command_id: string;
    payload_json: string;
    expected_remote_version: number | null;
    status: string;
  }>(
    "SELECT * FROM sync_outbox WHERE entity_type='mercalys_publication' ORDER BY local_sequence",
  );

it.each(["MERCALYS_SALES", "MERCALYS_WASTE"] as const)(
  "finishes a partial source with stable IDs, ordered immutable commands and no duplicates (%s)",
  async (flow) => {
    const s = await partialChatImportFixture(flow);
    try {
      const originalCommand = (await allPackets(s))[0]!;
      const review = (await s.controller.run(s.file.message)).items[0]!;
      expect(review).toMatchObject({
        status: "REVIEW",
        publishedCount: 1,
        priorSourceDocumentId: s.publication.sourceDocumentId,
      });
      if (review.status !== "REVIEW") throw Error("review");
      const events = await s.a.getAllAsync<{ payload_json: string }>(
        "SELECT payload_json FROM copilot_messages WHERE json_extract(payload_json,'$.replyToMessageId')=?",
        s.file.message.id,
      );
      expect(
        events.map(
          (e) =>
            readCopilotImportStatus(JSON.parse(e.payload_json)).status.items[0],
        ),
      ).toContainEqual(
        expect.objectContaining({
          status: "REVIEW",
          sourceDocumentId: s.publication.sourceDocumentId,
          publishedCount: 1,
          remainingCount: 1,
        }),
      );
      expect(review.resolutions).toHaveLength(1);
      expect(review.overlap).toBeNull();
      await s.controller.resolve(s.file.message, review, {
        resolutionKey: review.resolutions[0]!.key,
        productId: s.productId,
      });
      const result = (await s.controller.run(s.file.message)).items[0]!;
      expect(result).toMatchObject({
        status: "PUBLISHED",
        completedPartial: true,
        sourceDocumentId: s.publication.sourceDocumentId,
        publishedCount: 2,
      });
      const complete = (await readMercalysPublication(
        s.a,
        s.scope.storeId,
        s.publication.sourceDocumentId,
      ))!;
      expect([...complete.sales, ...complete.waste]).toHaveLength(2);
      expect(
        [...complete.sales, ...complete.waste].find(
          (o) => o.sourceRecordId === s.initial.records[0]!.id,
        ),
      ).toEqual([...s.initial.sales, ...s.initial.waste][0]);
      expect(complete.records.map((r) => r.id)).toEqual(
        s.initial.records.map((r) => r.id),
      );
      expect(complete.records.map((r) => r.rawPayload)).toEqual(
        s.initial.records.map((r) => r.rawPayload),
      );
      expect(complete.records.map((r) => r.version)).toEqual([1, 2]);
      expect(
        Number(
          s.db.prepare("SELECT COUNT(*) n FROM source_documents").get()!.n,
        ),
      ).toBe(1);
      expect(
        Number(s.db.prepare("SELECT COUNT(*) n FROM local_files").get()!.n),
      ).toBe(1);
      const packets = await allPackets(s);
      expect(packets).toHaveLength(2);
      expect(packets[0]).toEqual(originalCommand);
      expect(packets.map((p) => p.expected_remote_version)).toEqual([null, 1]);
      expect(
        (await new OutboxRepository(s.a).listPending(s.scope.storeId))
          .filter((c) => c.entityType === "mercalys_publication")
          .map((c) => c.commandId),
      ).toEqual([packets[0]!.command_id]);
      const remote1 = {
        id: s.publication.sourceDocumentId,
        storeId: s.scope.storeId,
        remoteVersion: 1,
        publication: JSON.parse(packets[0]!.payload_json),
      };
      await new OutboxRepository(s.a).markSyncing(packets[0]!.command_id);
      await s.a.withExclusiveTransactionAsync((tx) =>
        applyMercalysPublication(tx, s.scope.storeId, remote1, true),
      );
      await new OutboxRepository(s.a).markAcknowledged(packets[0]!.command_id);
      expect(
        (await readMercalysPublication(
          s.a,
          s.scope.storeId,
          remote1.id,
        ))!.records.map((r) => r.status),
      ).toEqual(["PUBLISHED", "PUBLISHED"]);
      expect(
        Number(s.db.prepare(`SELECT COUNT(*) n FROM ${table(flow)}`).get()!.n),
      ).toBe(2);
      expect(
        (await new OutboxRepository(s.a).listPending(s.scope.storeId))
          .filter((c) => c.entityType === "mercalys_publication")
          .map((c) => c.commandId),
      ).toEqual([packets[1]!.command_id]);
      const remote2 = {
        ...remote1,
        remoteVersion: 2,
        publication: JSON.parse(packets[1]!.payload_json),
      };
      await new OutboxRepository(s.a).markSyncing(packets[1]!.command_id);
      await s.a.withExclusiveTransactionAsync((tx) =>
        applyMercalysPublication(tx, s.scope.storeId, remote2, true),
      );
      await new OutboxRepository(s.a).markAcknowledged(packets[1]!.command_id);
      await repairMercalysPublications(s.a, s.scope.storeId, randomUUID);
      expect(await allPackets(s)).toHaveLength(2);
      expect((await s.controller.run(s.file.message)).items[0]).toMatchObject({
        status: "PUBLISHED",
        alreadyPublished: true,
      });
      const other = new MercalysTestDatabase();
      try {
        await mercalysLocalFixture(other, s.scope.storeId, s.productId);
        await other.withExclusiveTransactionAsync((tx) =>
          applyMercalysPublication(tx, s.scope.storeId, remote1),
        );
        expect(
          (await readMercalysPublication(other, s.scope.storeId, remote1.id))!
            .records[1]!.status,
        ).toBe("WARNING");
        await other.withExclusiveTransactionAsync((tx) =>
          applyMercalysPublication(tx, s.scope.storeId, remote2),
        );
        await other.withExclusiveTransactionAsync((tx) =>
          applyMercalysPublication(tx, s.scope.storeId, remote1),
        );
        expect(
          (await readMercalysPublication(
            other,
            s.scope.storeId,
            remote1.id,
          ))!.records.map((r) => [r.id, r.status, r.version]),
        ).toEqual(complete.records.map((r) => [r.id, r.status, r.version]));
        expect(
          await other.getFirstAsync(`SELECT COUNT(*) n FROM ${table(flow)}`),
        ).toEqual({ n: 2 });
      } finally {
        other.db.close();
      }
    } finally {
      s.db.close();
    }
  },
);

it("resumes already-unambiguous remaining references automatically without inventing a new source", async () => {
  const s = await partialChatImportFixture("MERCALYS_SALES", ":memory:", false);
  try {
    expect((await s.controller.run(s.file.message)).items[0]).toMatchObject({
      status: "PUBLISHED",
      completedPartial: true,
      sourceDocumentId: s.publication.sourceDocumentId,
    });
    expect(
      Number(s.db.prepare("SELECT COUNT(*) n FROM products").get()!.n),
    ).toBe(2);
    expect(await allPackets(s)).toHaveLength(2);
  } finally {
    s.db.close();
  }
});

it("rejects altered source values without changing the existing partial source", async () => {
  const s = await partialChatImportFixture();
  try {
    const summary = structuredClone(s.summary);
    summary.lines[0]!.record.quantity += 1;
    await expect(
      new MercalysImportPublicationRepository(s.a, randomUUID).resume({
        storeId: s.scope.storeId,
        sourceDocumentId: s.publication.sourceDocumentId,
        checksum: s.file.f.input.checksum,
        summary,
      }),
    ).rejects.toThrow("MERCALYS_CONTINUATION_SOURCE_CHANGED");
    expect(
      await readMercalysPublication(
        s.a,
        s.scope.storeId,
        s.publication.sourceDocumentId,
      ),
    ).toEqual(s.initial);
    expect(await allPackets(s)).toHaveLength(1);
  } finally {
    s.db.close();
  }
});

it("freezes an in-flight initial packet and blocks the continuation until its acknowledgement", async () => {
  const s = await partialChatImportFixture();
  try {
    const first = (await allPackets(s))[0]!;
    await new OutboxRepository(s.a).markSyncing(first.command_id);
    const frozen = (await allPackets(s))[0]!;
    const review = (await s.controller.run(s.file.message)).items[0]!;
    if (review.status !== "REVIEW") throw Error("review");
    await s.controller.resolve(s.file.message, review, {
      resolutionKey: review.resolutions[0]!.key,
      productId: s.productId,
    });
    expect((await s.controller.run(s.file.message)).items[0]?.status).toBe(
      "PUBLISHED",
    );
    expect((await allPackets(s))[0]).toEqual(frozen);
    expect((await allPackets(s))[1]!.expected_remote_version).toBe(1);
    expect(
      (await new OutboxRepository(s.a).listPending(s.scope.storeId)).some(
        (c) => c.entityType === "mercalys_publication",
      ),
    ).toBe(false);
  } finally {
    s.db.close();
  }
});

it("pins historical published matches while asking only about pending rows", async () => {
  const s = await partialChatImportFixture();
  try {
    await s.a.runAsync(
      "UPDATE product_identifiers SET status='TO_REVIEW' WHERE value='00000001'",
    );
    const review = (await s.controller.run(s.file.message)).items[0]!;
    if (review.status !== "REVIEW") throw Error("review");
    expect(review.resolutions).toHaveLength(1);
    expect(review.resolutions[0]!.identifiers[0]!.value).toBe("00000002");
    expect(review.summary.lines[0]!.match.matchedProductId).toBe(s.productId);
    expect(
      (await readMercalysPublication(
        s.a,
        s.scope.storeId,
        s.publication.sourceDocumentId,
      ))!.sales,
    ).toEqual(s.initial.sales);
  } finally {
    s.db.close();
  }
});
it("does not charge classification or change catalogue metadata for historical published rows", async () => {
  const s = await partialChatImportFixture();
  try {
    await s.a.runAsync(
      "UPDATE products SET category='UNKNOWN' WHERE id=?",
      s.productId,
    );
    expect((await s.controller.run(s.file.message)).items[0]).toMatchObject({
      status: "REVIEW",
      publishedCount: 1,
    });
    expect(s.calls()).toBe(0);
    expect(
      s.db.prepare("SELECT category FROM products WHERE id=?").get(s.productId)!
        .category,
    ).toBe("UNKNOWN");
  } finally {
    s.db.close();
  }
});

it.each([
  "PERMISSION",
  "DELETED",
  "SOURCE",
  "CONFLICT",
  "FAILED_PACKET",
  "SUPERSEDED",
  "COMMIT",
  "CANCEL",
])(
  "preserves published rows and unfinished work on a failed resume (%s)",
  async (mode) => {
    const s = await partialChatImportFixture();
    try {
      const review = (await s.controller.run(s.file.message)).items[0]!;
      if (review.status !== "REVIEW") throw Error("review");
      await s.controller.resolve(s.file.message, review, {
        resolutionKey: review.resolutions[0]!.key,
        productId: s.productId,
      });
      if (mode === "PERMISSION") s.scope.canImport = false;
      if (mode === "DELETED")
        await s.chat.removeMessage(s.conversation.id, s.file.message.id);
      if (mode === "SOURCE")
        s.bytes.set(s.file.batch.files[0]!.localUri, new Uint8Array([0]));
      if (mode === "CONFLICT")
        await s.a.runAsync("UPDATE source_documents SET sync_state='CONFLICT'");
      if (mode === "SUPERSEDED")
        await s.a.runAsync(
          "UPDATE sales_observations SET deleted_at='2026-10-18T12:00:00.000Z'",
        );
      if (mode === "FAILED_PACKET")
        await s.a.runAsync(
          "UPDATE sync_outbox SET status='FAILED' WHERE entity_type='mercalys_publication'",
        );
      if (mode === "COMMIT") s.a.fail = true;
      const abort = new AbortController();
      if (mode === "CANCEL")
        s.a.afterRun = (sql) => {
          if (sql.includes("INSERT INTO sales_observations")) abort.abort();
        };
      const before = await readMercalysPublication(
          s.a,
          s.scope.storeId,
          s.publication.sourceDocumentId,
        ),
        packets = await allPackets(s);
      const result = await s.controller
        .run(s.file.message, abort.signal)
        .catch(() => null);
      expect(result?.items[0]?.status).not.toBe("PUBLISHED");
      expect(
        await readMercalysPublication(
          s.a,
          s.scope.storeId,
          s.publication.sourceDocumentId,
        ),
      ).toEqual(before);
      expect(await allPackets(s)).toEqual(packets);
      if (mode === "COMMIT") {
        s.a.fail = false;
        expect((await s.controller.run(s.file.message)).items[0]?.status).toBe(
          "PUBLISHED",
        );
      }
    } finally {
      s.db.close();
    }
  },
);

it("restarts after partial completion and replays neither identities nor observations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-resume-")),
    path = join(dir, "phone.db");
  const s = await partialChatImportFixture("MERCALYS_WASTE", path, false);
  let reopened: DatabaseSync | undefined;
  try {
    await s.controller.run(s.file.message);
    const packets = await allPackets(s);
    s.db.close();
    reopened = new DatabaseSync(path);
    const adapter = new ReceiptTestDatabase(reopened),
      controller = new CopilotMercalysImportController(
        adapter,
        s.scope,
        s.deps,
      );
    expect((await controller.run(s.file.message)).items[0]).toMatchObject({
      status: "PUBLISHED",
      alreadyPublished: true,
      sourceDocumentId: s.publication.sourceDocumentId,
    });
    expect(
      Number(
        reopened.prepare("SELECT COUNT(*) n FROM waste_observations").get()!.n,
      ),
    ).toBe(2);
    expect(
      await adapter.getAllAsync(
        "SELECT * FROM sync_outbox WHERE entity_type='mercalys_publication' ORDER BY local_sequence",
      ),
    ).toEqual(packets);
  } finally {
    reopened?.close();
    if (!reopened) s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
