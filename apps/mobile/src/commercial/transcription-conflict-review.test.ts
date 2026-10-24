import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { nativeCommercialTranscriptionFixture } from "../../../../scripts/test-commercial-transcription-fixtures";
import {
  receiptReviewDigest,
  ReceiptTestDatabase,
} from "../../../../scripts/test-receipt-publication-sqlite";
import {
  CommercialReviewRepository,
  applyCommercialReviewEntity,
} from "./review-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
type Fixture = Awaited<ReturnType<typeof nativeCommercialTranscriptionFixture>>;
const fixtures: Fixture[] = [];
async function setup(path = ":memory:") {
  const s = await nativeCommercialTranscriptionFixture(path);
  fixtures.push(s);
  return s;
}
afterEach(() => {
  for (const s of fixtures.splice(0))
    try {
      s.db.close();
    } catch {
      /* deliberately reopened */
    }
});
const tables = [
  "commercial_review_pages",
  "commercial_review_decisions",
  "sync_outbox",
  "sync_conflicts",
  "sales_observations",
  "waste_observations",
];
const snapshot = (s: Fixture) =>
  tables.map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
const ctx = (s: Fixture, hash: string) => ({
  actorId: s.scope.ownerId,
  deviceId: s.scope.deviceId,
  actionId: randomUUID(),
  reviewHash: hash,
  canResolve: () => true,
});
async function add(s: Fixture) {
  const command = await new OutboxRepository(s.a).enqueue({
    ...s.command,
    commandId: randomUUID(),
  });
  await new OutboxRepository(s.a).markSyncing(command.commandId);
  await new OutboxRepository(s.a).markConflict(
    command.commandId,
    "COMMERCIAL_REVIEW_ALREADY_RECORDED",
  );
  return new ConflictRepository(s.a).recordPushConflict(command, {
    commandId: command.commandId,
    status: "CONFLICT",
    entityType: command.entityType,
    entityId: s.local.id,
    remoteVersion: 1,
    remoteEntity: s.envelope,
  });
}
it.each([1, 3])(
  "adopts the immutable accepted choice across %s actual conflicts, preserving raw packets and replay after restart",
  async (count) => {
    const dir = mkdtempSync(join(tmpdir(), "fl-transcription-")),
      path = join(dir, "device.db"),
      s = await setup(path);
    let reopened: DatabaseSync | undefined;
    try {
      for (let i = 1; i < count; i++) await add(s);
      expect(await s.repository.decisions(s.scope.storeId)).toHaveLength(2);
      const review = await s.repository.reviewConflict(
          s.scope.storeId,
          s.local.id,
          s.scope.ownerId,
        ),
        action = ctx(s, review.hash),
        original = s.db
          .prepare(
            "SELECT command_id,payload_json,local_sequence FROM sync_outbox ORDER BY local_sequence",
          )
          .all(),
        source = await s.repository.pages(s.scope.storeId);
      expect(review.canResolve).toBe(true);
      expect(review.group).toHaveLength(count);
      await s.repository.useRemoteDecision(
        s.scope.storeId,
        s.local.id,
        s.remote.id,
        action,
      );
      expect(await s.repository.decisions(s.scope.storeId)).toEqual([
        { decision: s.remote, state: "SYNCED" },
      ]);
      expect(await s.repository.pages(s.scope.storeId)).toEqual(source);
      expect(
        s.db
          .prepare(
            "SELECT command_id,payload_json,local_sequence FROM sync_outbox ORDER BY local_sequence",
          )
          .all(),
      ).toEqual(original);
      expect(
        s.db.prepare("SELECT status,last_error_code FROM sync_outbox").all(),
      ).toEqual(
        Array.from({ length: count }, () => ({
          status: "FAILED",
          last_error_code: "COMMERCIAL_REVIEW_SUPERSEDED",
        })),
      );
      expect(
        await new OutboxRepository(s.a).countActive(s.scope.storeId),
      ).toEqual({ pending_count: 0, failed_count: 0 });
      expect(
        (await new OutboxRepository(s.a).listFailures(s.scope.storeId)).items,
      ).toEqual([]);
      expect(
        JSON.parse(
          s.db
            .prepare(
              "SELECT payload_json FROM commercial_review_decisions WHERE id=?",
            )
            .get(s.local.id)!.payload_json as string,
        ),
      ).toEqual(s.local);
      expect(
        await new ConflictRepository(s.a).listOpen(s.scope.storeId),
      ).toEqual([]);
      const capture = (await new ConflictRepository(s.a).getById(
        action.actionId,
      ))!;
      expect(capture.conflictType).toBe(
        "COMMERCIAL_TRANSCRIPTION_REVIEW_CAPTURE",
      );
      expect(capture.commandId).toBeNull();
      expect(capture.localPayload).toMatchObject({
        decision: s.local,
        request: { actorId: s.scope.ownerId, reviewHash: review.hash },
      });
      const after = snapshot(s);
      await s.repository.useRemoteDecision(
        s.scope.storeId,
        s.local.id,
        s.remote.id,
        action,
      );
      expect(snapshot(s)).toEqual(after);
      await expect(
        s.repository.useRemoteDecision(
          s.scope.storeId,
          s.local.id,
          randomUUID(),
          action,
        ),
      ).rejects.toThrow("COMMAND_REUSED");
      s.db.close();
      reopened = new DatabaseSync(path);
      const repository = new CommercialReviewRepository(
        new ReceiptTestDatabase(reopened),
        receiptReviewDigest,
      );
      expect(await repository.decisions(s.scope.storeId)).toEqual([
        { decision: s.remote, state: "SYNCED" },
      ]);
      await repository.useRemoteDecision(
        s.scope.storeId,
        s.local.id,
        s.remote.id,
        action,
      );
      expect(
        reopened
          .prepare(
            "SELECT COUNT(*) n FROM sync_conflicts WHERE conflict_type='COMMERCIAL_TRANSCRIPTION_REVIEW_CAPTURE'",
          )
          .get()!.n,
      ).toBe(1);
      expect(
        reopened.prepare("SELECT COUNT(*) n FROM sales_observations").get()!.n,
      ).toBe(0);
    } finally {
      reopened?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
it.each(["GROUP", "COMMAND", "SOURCE", "ENVELOPE", "REMOTE"] as const)(
  "requires a new comparison after %s changes",
  async (mode) => {
    const s = await setup(),
      r = await s.repository.reviewConflict(
        s.scope.storeId,
        s.local.id,
        s.scope.ownerId,
      );
    if (mode === "GROUP") await add(s);
    if (mode === "COMMAND")
      await s.a.runAsync(
        "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
        s.command.commandId,
      );
    if (mode === "SOURCE")
      await s.a.runAsync(
        "UPDATE commercial_review_pages SET payload_json=?",
        JSON.stringify({ ...s.page, checksum: "sha256:changed" }),
      );
    if (mode === "ENVELOPE")
      await s.a.runAsync(
        "UPDATE sync_conflicts SET remote_version=2 WHERE id=?",
        s.conflict.id,
      );
    if (mode === "REMOTE")
      await s.a.runAsync(
        "UPDATE commercial_review_decisions SET sync_state='ERROR' WHERE id=?",
        s.remote.id,
      );
    const before = snapshot(s);
    await expect(
      s.repository.useRemoteDecision(
        s.scope.storeId,
        s.local.id,
        s.remote.id,
        ctx(s, r.hash),
      ),
    ).rejects.toThrow("SOURCE_CHANGED");
    expect(snapshot(s)).toEqual(before);
  },
);
it.each([
  "ENVELOPE",
  "WRONG_OCCURRENCE",
  "WRONG_SOURCE",
  "FOREIGN_REMOTE",
  "MISSING_SOURCE",
  "REMOTE_PAYLOAD",
  "MISSING_CONFLICT",
  "LOCAL_ACKNOWLEDGED",
  "COMMAND_BODY",
  "COMMAND_TYPE",
  "SYNCING",
  "LIMIT",
] as const)("blocks an unverified immutable comparison (%s)", async (mode) => {
  const s = await setup();
  if (mode === "ENVELOPE")
    await s.a.runAsync("UPDATE sync_conflicts SET remote_version=2");
  if (mode === "WRONG_OCCURRENCE")
    await s.a.runAsync(
      "UPDATE commercial_review_decisions SET source_block_index=2 WHERE id=?",
      s.remote.id,
    );
  if (mode === "WRONG_SOURCE")
    await s.a.runAsync(
      "UPDATE sync_conflicts SET remote_payload_json=?",
      JSON.stringify({
        ...s.envelope,
        decision: { ...s.remote, checksum: "sha256:wrong" },
      }),
    );
  if (mode === "FOREIGN_REMOTE") {
    const otherStore = randomUUID();
    await s.a.runAsync(
      "UPDATE sync_conflicts SET remote_payload_json=?",
      JSON.stringify({
        ...s.envelope,
        storeId: otherStore,
        decision: { ...s.remote, storeId: otherStore },
      }),
    );
  }
  if (mode === "MISSING_SOURCE")
    await s.a.runAsync("DELETE FROM commercial_review_pages");
  if (mode === "REMOTE_PAYLOAD")
    await s.a.runAsync(
      "UPDATE commercial_review_decisions SET payload_json=? WHERE id=?",
      JSON.stringify({ ...s.remote, decision: "CONFIRMED_TRANSCRIPTION" }),
      s.remote.id,
    );
  if (mode === "MISSING_CONFLICT")
    await s.a.runAsync("UPDATE sync_conflicts SET status='RESOLVED_REMOTE'");
  if (mode === "LOCAL_ACKNOWLEDGED")
    await s.a.runAsync(
      "UPDATE commercial_review_decisions SET remote_version=1,sync_state='SYNCED' WHERE id=?",
      s.local.id,
    );
  if (mode === "COMMAND_BODY")
    await s.a.runAsync(
      "UPDATE sync_outbox SET payload_json=? WHERE command_id=?",
      JSON.stringify({ ...s.local, checksum: "sha256:wrong" }),
      s.command.commandId,
    );
  if (mode === "COMMAND_TYPE")
    await s.a.runAsync(
      "UPDATE sync_outbox SET command_type='PRODUCT_UPSERT' WHERE command_id=?",
      s.command.commandId,
    );
  if (mode === "SYNCING")
    await s.a.runAsync(
      "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
      s.command.commandId,
    );
  if (mode === "LIMIT") for (let i = 0; i < 100; i++) await add(s);
  const r = await s.repository.reviewConflict(
      s.scope.storeId,
      s.local.id,
      s.scope.ownerId,
    ),
    before = snapshot(s);
  expect(r.canResolve).toBe(false);
  if (mode === "FOREIGN_REMOTE") expect(r.remote).toBeNull();
  await expect(
    s.repository.useRemoteDecision(
      s.scope.storeId,
      s.local.id,
      s.remote.id,
      ctx(s, r.hash),
    ),
  ).rejects.toThrow();
  expect(snapshot(s)).toEqual(before);
});
it.each([
  "OWNER",
  "DEVICE",
  "CANCEL",
  "AFTER_READ",
  "AFTER_WRITE",
  "COMMIT",
] as const)(
  "rolls back every source/decision/command change on %s failure",
  async (mode) => {
    const s = await setup(),
      r = await s.repository.reviewConflict(
        s.scope.storeId,
        s.local.id,
        s.scope.ownerId,
      ),
      before = snapshot(s),
      abort = new AbortController();
    let allowed = true;
    if (mode === "CANCEL") abort.abort();
    if (mode === "COMMIT") s.a.fail = true;
    if (mode === "AFTER_WRITE")
      s.a.afterRun = (sql) => {
        if (sql.includes("UPDATE commercial_review_decisions")) allowed = false;
      };
    const repository =
      mode === "AFTER_READ"
        ? new CommercialReviewRepository(s.a, async (value) => {
            allowed = false;
            return receiptReviewDigest(value);
          })
        : s.repository;
    await expect(
      repository.useRemoteDecision(s.scope.storeId, s.local.id, s.remote.id, {
        ...ctx(s, r.hash),
        signal: abort.signal,
        canResolve: () => allowed,
        ...(mode === "OWNER" ? { actorId: randomUUID() } : {}),
        ...(mode === "DEVICE" ? { deviceId: randomUUID() } : {}),
      }),
    ).rejects.toThrow();
    expect(snapshot(s)).toEqual(before);
  },
);
it.each(["SINGLE", "GROUP"] as const)(
  "guards ordinary %s reviews through the final Outbox insertion",
  async (mode) => {
    const s = await setup(),
      page = {
        ...s.page,
        id: randomUUID(),
        sourceDocumentId: randomUUID(),
        blocks: s.page.blocks.map((b) => ({
          ...b,
          fields: b.fields.map((f) => ({ ...f, confidence: 0.99 })),
        })),
      };
    await applyCommercialReviewEntity(
      s.a,
      s.scope.storeId,
      "commercial_review_page",
      page,
    );
    const before = snapshot(s);
    let allowed = true;
    s.a.afterRun = (sql) => {
      if (sql.includes("INSERT INTO sync_outbox")) allowed = false;
    };
    const current = { canResolve: () => allowed },
      d = {
        ...s.local,
        id: randomUUID(),
        pageId: page.id,
        sourceDocumentId: page.sourceDocumentId,
      };
    await expect(
      mode === "SINGLE"
        ? s.repository.review(d, s.scope.deviceId, randomUUID(), current)
        : s.repository.reviewReadableGroup(
            {
              storeId: s.scope.storeId,
              sourceDocumentId: page.sourceDocumentId,
              deviceId: s.scope.deviceId,
              reviewedAt: d.reviewedAt,
              entries: [
                {
                  pageId: page.id,
                  sourceBlockIndex: 0,
                  id: d.id,
                  commandId: randomUUID(),
                },
              ],
            },
            current,
          ),
    ).rejects.toThrow("AUTHORITY_CHANGED");
    expect(snapshot(s)).toEqual(before);
  },
);
it("reads a document's decisions once without duplicating rows for repeated command attempts", async () => {
  const s = await setup();
  await add(s);
  await add(s);
  expect(
    await s.repository.decisions(s.scope.storeId, s.page.sourceDocumentId),
  ).toHaveLength(2);
  expect(await s.repository.decisions(s.scope.storeId, randomUUID())).toEqual(
    [],
  );
  const reads: string[] = [],
    original = s.a.getAllAsync.bind(s.a);
  s.a.getAllAsync = async (sql, ...params) => {
    reads.push(sql);
    return original(sql, ...params);
  };
  const values = await s.repository.decisions(
    s.scope.storeId,
    s.page.sourceDocumentId,
  );
  expect(values.find((v) => v.decision.id === s.local.id)?.state).toBe(
    "CONFLICT",
  );
  expect(reads).toHaveLength(1);
});
