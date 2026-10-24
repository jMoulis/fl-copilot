import { CommercialReviewRepository } from "../commercial/review-repository";
import {
  runReviewedStoreOperation,
  joinedProductToolDatabase,
} from "./product-tool-transaction";
import {
  transcriptionReviewRequestSchema,
  transcriptionReviewResultSchema,
} from "@fl-copilot/domain";
import { applyCommercialReviewEntity } from "../commercial/review-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { copilotTranscriptionFixture } from "../../../../scripts/test-copilot-transcription-fixtures";
import { serializedTestDatabase } from "../../../../scripts/test-serialized-sqlite";
import { receiptReviewDigest } from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotTranscriptionReviewController } from "./transcription-review-controller";
import { transcriptionReviewInputSchema } from "@fl-copilot/domain";
type F = Awaited<ReturnType<typeof copilotTranscriptionFixture>>;
const fixtures: F[] = [];
async function setup(path = ":memory:", additionalBlocks = 0) {
  const s = await copilotTranscriptionFixture(path, additionalBlocks);
  fixtures.push(s);
  return s;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const s of fixtures.splice(0)) {
    try {
      s.db.close();
    } catch {
      /* deliberately reopened */
    }
  }
});
const tables = [
  "source_documents",
  "commercial_review_pages",
  "commercial_review_decisions",
  "sync_outbox",
  "sync_conflicts",
  "copilot_tool_results",
  "sales_observations",
  "waste_observations",
];
const snapshot = (s: F) =>
  tables.map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
async function ready(s: F) {
  const r = await s.controller.review(s.message, s.local.id);
  if (r.status !== "READY") throw Error("REVIEW_NOT_READY");
  return r.review;
}
it("compares locally, adopts through the canonical immutable service and replays exactly once", async () => {
  const s = await setup(),
    before = snapshot(s),
    list = await s.controller.list(s.message);
  expect(list.items.map((v) => v.id)).toEqual([s.local.id]);
  expect(list.completed).toEqual([]);
  expect(snapshot(s)).toEqual(before);
  const r = await ready(s),
    result = await s.controller.confirm(s.message, s.local.id, r.hash, true);
  expect(result.remoteId).toBe(s.remote.id);
  expect(result.pageNumber).toBe(1);
  expect(await s.repository.decisions(s.scope.storeId)).toEqual([
    { decision: s.remote, state: "SYNCED" },
  ]);
  const packets = s.db
    .prepare(
      "SELECT command_id,payload_json,local_sequence FROM sync_outbox ORDER BY local_sequence",
    )
    .all();
  expect(
    s.db
      .prepare(
        "SELECT status,last_error_code FROM sync_outbox WHERE command_id=?",
      )
      .get(s.command.commandId),
  ).toEqual({
    status: "FAILED",
    last_error_code: "COMMERCIAL_REVIEW_SUPERSEDED",
  });
  const after = snapshot(s);
  expect(
    await s.controller.confirm(s.message, s.local.id, r.hash, true),
  ).toEqual(result);
  expect(snapshot(s)).toEqual(after);
  expect(
    s.db
      .prepare(
        "SELECT command_id,payload_json,local_sequence FROM sync_outbox ORDER BY local_sequence",
      )
      .all(),
  ).toEqual(packets);
  const done = await s.controller.list(s.message);
  expect(done.items).toEqual([]);
  expect(done.completed).toEqual([result]);
  expect((await s.controller.review(s.message, s.local.id)).status).toBe(
    "COMPLETED",
  );
  expect(s.db.prepare("SELECT * FROM source_documents").all()).toEqual(
    before[0],
  );
  expect(s.db.prepare("SELECT * FROM commercial_review_pages").all()).toEqual(
    before[1],
  );
});
it.each([
  "RIGHTS",
  "COMPARE",
  "HASH",
  "ABORT",
  "DEVICE",
  "SOURCE",
  "PARENT",
  "CANCEL_DURING_WRITE",
  "CANCEL_AFTER_JOURNAL",
  "JOURNAL_FAILURE",
])(
  "refuses %s atomically, retaining sources, captures, public packets and private journal",
  async (kind) => {
    const s = await setup(),
      r = await ready(s);
    let current = true;
    const abort = new AbortController();
    let controller = s.controller;
    if (kind === "RIGHTS")
      controller = new CopilotTranscriptionReviewController(
        s.dbAdapter,
        { ...s.scope, canReviewTranscriptions: false },
        receiptReviewDigest,
      );
    if (kind === "DEVICE")
      controller = new CopilotTranscriptionReviewController(
        s.dbAdapter,
        { ...s.scope, deviceId: randomUUID() },
        receiptReviewDigest,
      );
    if (kind === "SOURCE")
      await s.dbAdapter.runAsync(
        "UPDATE source_documents SET checksum='different-original' WHERE id=?",
        s.page.sourceDocumentId,
      );
    if (kind === "PARENT")
      await s.dbAdapter.runAsync(
        "UPDATE copilot_conversations SET payload_json=json_set(payload_json,'$.status','ARCHIVED') WHERE id=?",
        s.chat.conversation.id,
      );
    if (kind === "ABORT") abort.abort();
    const before = snapshot(s);
    const original = s.dbAdapter.transaction.runAsync.bind(
      s.dbAdapter.transaction,
    );
    if (
      kind === "CANCEL_DURING_WRITE" ||
      kind === "CANCEL_AFTER_JOURNAL" ||
      kind === "JOURNAL_FAILURE"
    )
      vi.spyOn(s.dbAdapter.transaction, "runAsync").mockImplementation(
        async (sql, ...args) => {
          const result = await original(sql, ...args);
          if (
            kind === "CANCEL_DURING_WRITE" &&
            sql.includes("UPDATE commercial_review_decisions")
          )
            current = false;
          if (
            kind === "CANCEL_AFTER_JOURNAL" &&
            sql.includes("INSERT INTO copilot_tool_results")
          )
            current = false;
          if (
            kind === "JOURNAL_FAILURE" &&
            sql.includes("INSERT INTO copilot_tool_results")
          )
            throw Error("TEST_JOURNAL_FAILURE");
          return result;
        },
      );
    await expect(
      controller.confirm(
        s.message,
        s.local.id,
        kind === "HASH" ? "f".repeat(64) : r.hash,
        kind !== "COMPARE",
        abort.signal,
        () => current,
      ),
    ).rejects.toThrow();
    expect(snapshot(s)).toEqual(before);
  },
);
it("returns the recorded result after actual SQLite file close/reopen, without another public command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-chat-transcription-")),
    path = join(dir, "device.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const r = await ready(s),
      result = await s.controller.confirm(s.message, s.local.id, r.hash, true),
      before = snapshot(s);
    s.db.close();
    reopened = new DatabaseSync(path);
    const controller = new CopilotTranscriptionReviewController(
      serializedTestDatabase(reopened),
      s.scope,
      receiptReviewDigest,
    );
    expect(
      await controller.confirm(s.message, s.local.id, r.hash, true),
    ).toEqual(result);
    expect((await controller.list(s.message)).completed).toEqual([result]);
    for (let i = 0; i < tables.length; i++)
      expect(
        reopened.prepare(`SELECT * FROM ${tables[i]} ORDER BY rowid`).all(),
      ).toEqual(before[i]);
  } finally {
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("strict model arguments cannot choose local decisions, corrections or approval", () => {
  expect(
    transcriptionReviewInputSchema.safeParse({
      sourceDocumentId: randomUUID(),
      localId: randomUUID(),
      comparisonReviewed: true,
    }).success,
  ).toBe(false);
});

async function addOccurrence(s: F, index: number, foreignSource = false) {
  const page = foreignSource
    ? { ...s.page, id: randomUUID(), sourceDocumentId: randomUUID() }
    : s.page;
  if (foreignSource)
    await applyCommercialReviewEntity(
      s.a,
      s.scope.storeId,
      "commercial_review_page",
      page,
    );
  const local = {
      ...s.local,
      id: randomUUID(),
      pageId: page.id,
      sourceDocumentId: page.sourceDocumentId,
      sourceBlockIndex: index,
    },
    remote = {
      ...s.remote,
      id: randomUUID(),
      pageId: page.id,
      sourceDocumentId: page.sourceDocumentId,
      sourceBlockIndex: index,
    },
    envelope = {
      id: remote.id,
      storeId: s.scope.storeId,
      remoteVersion: 1 as const,
      decision: remote,
    };
  await s.repository.review(local, s.scope.deviceId, randomUUID());
  await applyCommercialReviewEntity(
    s.a,
    s.scope.storeId,
    "commercial_review_decision",
    envelope,
  );
  const command = (
    await new OutboxRepository(s.a).listPending(s.scope.storeId)
  ).find((c) => c.entityId === local.id)!;
  await new ConflictRepository(s.a).recordPushConflict(command, {
    commandId: command.commandId,
    status: "CONFLICT",
    entityType: command.entityType,
    entityId: command.entityId,
    remoteVersion: 1,
    remoteEntity: envelope,
  });
  await new OutboxRepository(s.a).markSyncing(command.commandId);
  await new OutboxRepository(s.a).markConflict(
    command.commandId,
    "COMMERCIAL_REVIEW_ALREADY_RECORDED",
  );
  return { local, remote };
}
it("pages thirteen actual conflict occurrences, keeps native choices distinct and refuses another document", async () => {
  const s = await setup(":memory:", 12);
  for (let i = 1; i <= 12; i++) await addOccurrence(s, i);
  const other = await addOccurrence(s, 0, true),
    before = snapshot(s),
    first = await s.controller.list(s.message);
  expect(first.items).toHaveLength(10);
  expect(first.nextCursor).not.toBeNull();
  const next = await s.controller.list(s.message, first.nextCursor);
  expect(next.items).toHaveLength(3);
  expect(next.nextCursor).toBeNull();
  expect(new Set([...first.items, ...next.items].map((v) => v.id)).size).toBe(
    13,
  );
  expect(
    [...first.items, ...next.items].some((v) => v.id === other.local.id),
  ).toBe(false);
  await expect(s.controller.review(s.message, other.local.id)).rejects.toThrow(
    "TRANSCRIPTION_REVIEW_SCOPE_INVALID",
  );
  expect(snapshot(s)).toEqual(before);
  const a = await s.controller.review(s.message, first.items[0]!.id);
  if (a.status !== "READY") throw Error("NOT_READY");
  await s.controller.confirm(
    s.message,
    first.items[0]!.id,
    a.review.hash,
    true,
  );
  const b = await s.controller.review(s.message, first.items[1]!.id);
  if (b.status !== "READY") throw Error("NOT_READY");
  await s.controller.confirm(
    s.message,
    first.items[1]!.id,
    b.review.hash,
    true,
  );
  expect((await s.controller.list(s.message)).completed).toHaveLength(2);
});
it("serializes simultaneous confirmations and writes one private result/canonical capture", async () => {
  const s = await setup(),
    r = await ready(s);
  const results = await Promise.all([
    s.controller.confirm(s.message, s.local.id, r.hash, true),
    s.controller.confirm(s.message, s.local.id, r.hash, true),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    s.db.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get(),
  ).toEqual({ n: 1 });
  expect(
    s.db
      .prepare(
        "SELECT COUNT(*) n FROM sync_conflicts WHERE conflict_type='COMMERCIAL_TRANSCRIPTION_REVIEW_CAPTURE'",
      )
      .get(),
  ).toEqual({ n: 1 });
});
it("does not replay a private result if its TOOL message is deleted before the transaction begins", async () => {
  const s = await setup(),
    r = await ready(s);
  await s.controller.confirm(s.message, s.local.id, r.hash, true);
  const before = snapshot(s),
    original = s.dbAdapter.withExclusiveTransactionAsync.bind(s.dbAdapter);
  let changed = false;
  vi.spyOn(s.dbAdapter, "withExclusiveTransactionAsync").mockImplementation(
    async (task) => {
      if (!changed) {
        changed = true;
        await s.dbAdapter.transaction.runAsync(
          "UPDATE copilot_conversations SET payload_json=json_set(payload_json,'$.deletedMessageIds',json(?)) WHERE id=?",
          JSON.stringify([s.message.id]),
          s.chat.conversation.id,
        );
      }
      return original(task);
    },
  );
  await expect(
    s.controller.confirm(s.message, s.local.id, r.hash, true),
  ).rejects.toThrow("COPILOT_PROPOSAL_UNAVAILABLE");
  expect(snapshot(s)).toEqual(before);
});
it("returns the committed adoption even if later database reads would fail", async () => {
  const s = await setup(),
    r = await ready(s),
    original = s.dbAdapter.withExclusiveTransactionAsync.bind(s.dbAdapter);
  let committed = false;
  vi.spyOn(s.dbAdapter, "withExclusiveTransactionAsync").mockImplementation(
    async (task) => {
      await original(task);
      committed = true;
    },
  );
  const read = s.dbAdapter.getFirstAsync.bind(s.dbAdapter);
  vi.spyOn(s.dbAdapter, "getFirstAsync").mockImplementation(async (...args) => {
    if (committed) throw Error("POST_COMMIT_READ_FAILED");
    return read(...args);
  });
  const result = await s.controller.confirm(
    s.message,
    s.local.id,
    r.hash,
    true,
  );
  expect(result.remoteId).toBe(s.remote.id);
  expect(committed).toBe(true);
});

it("the shared private-operation transaction rolls back if cancellation arrives during its journal insert", async () => {
  const s = await setup(),
    r = await ready(s),
    cancel = new AbortController(),
    before = snapshot(s),
    request = transcriptionReviewRequestSchema.parse({
      operationId: randomUUID(),
      proposalMessageId: s.message.id,
      localId: s.local.id,
      basisHash: r.hash,
    });
  const original = s.dbAdapter.transaction.runAsync.bind(
    s.dbAdapter.transaction,
  );
  vi.spyOn(s.dbAdapter.transaction, "runAsync").mockImplementation(
    async (sql, ...params) => {
      const result = await original(sql, ...params);
      if (sql.includes("INSERT INTO copilot_tool_results")) cancel.abort();
      return result;
    },
  );
  await expect(
    runReviewedStoreOperation(
      s.dbAdapter,
      request,
      {
        storeId: s.scope.storeId,
        ownerId: s.scope.ownerId,
        deviceId: s.scope.deviceId,
        canExecute: true,
        conversationId: s.message.conversationId,
        userMessageId: s.message.replyToMessageId!,
        decisionLevel: "REVIEWED",
        authorizedRequestJson: JSON.stringify(request),
      },
      transcriptionReviewResultSchema,
      async (tx, ctx) => {
        await new CommercialReviewRepository(
          joinedProductToolDatabase(tx),
          receiptReviewDigest,
        ).useRemoteDecision(ctx.storeId, s.local.id, s.remote.id, {
          actorId: ctx.ownerId,
          deviceId: ctx.deviceId,
          actionId: request.operationId,
          reviewHash: r.hash,
          canResolve: () => true,
        });
        return {
          ...request,
          userMessageId: ctx.userMessageId,
          appliedAt: "2026-10-24T08:03:00.000Z",
          sourceDocumentId: s.page.sourceDocumentId,
          remoteId: s.remote.id,
          pageId: s.page.id,
          pageNumber: 1,
          sourceBlockIndex: 0,
          decision: "ADOPT_REMOTE" as const,
        };
      },
      cancel.signal,
    ),
  ).rejects.toMatchObject({ code: "CANCELLED" });
  expect(snapshot(s)).toEqual(before);
});
