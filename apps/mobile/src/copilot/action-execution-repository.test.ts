import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionExecutionFixture } from "../../../../scripts/test-action-execution-fixtures";
import { MercalysTestDatabase } from "../../../../scripts/test-mercalys-sync-fixtures";
import { decisionDigest } from "../../../../scripts/test-copilot-decision-fixtures";
import {
  CopilotActionExecutionRepository,
  applyActionExecutionRecord,
} from "./action-execution-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import {
  copilotMessageSchema,
  readActionExecutionProposal,
  actionExecutionSchema,
  actionExecutionsReadResultSchema,
} from "@fl-copilot/domain";
it("records a realization without a prior acceptance, survives restart, and retains a one-way withdrawal with no business-figure mutation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-action-")),
    path = join(dir, "device.db");
  let db = new MercalysTestDatabase(new DatabaseSync(path));
  const f = await actionExecutionFixture(db);
  try {
    expect(
      await db.getAllAsync("SELECT * FROM copilot_decisions"),
    ).toHaveLength(0);
    let s = await f.repository.open(f.actionCard);
    expect(s.status).toBe("READY");
    expect(s.link).toBeNull();
    s = await f.repository.save(f.actionCard, s.review);
    expect(s.status).toBe("CONFIRMED");
    const saved = s.link!;
    expect(saved.recommendationId).toBe(
      readActionExecutionProposal(f.actionCard).content.recommendationId,
    );
    expect(saved.decisionId).toBeNull();
    expect((await f.repository.save(f.actionCard, s.review)).link).toEqual(
      saved,
    );
    db.db.close();
    db = new MercalysTestDatabase(new DatabaseSync(path));
    const repo = new CopilotActionExecutionRepository(
      db,
      f.actionScope,
      decisionDigest,
      randomUUID,
      () => "2026-10-18T13:00:00.000Z",
    );
    s = await repo.open(f.actionCard);
    expect(s.link).toEqual(saved);
    s = await repo.save(f.actionCard, s.review, true);
    expect(s.link).toMatchObject({
      version: 2,
      status: "WITHDRAWN",
      snapshot: saved.snapshot,
    });
    expect((await repo.save(f.actionCard, s.review)).status).toBe("WITHDRAWN");
    expect(
      await db.getAllAsync("SELECT * FROM copilot_decisions"),
    ).toHaveLength(0);
    expect(
      await db.getAllAsync("SELECT * FROM commercial_execution_tasks"),
    ).toHaveLength(0);
    expect(
      (
        await db.getAllAsync<{ payload_json: string }>(
          "SELECT payload_json FROM sync_outbox WHERE entity_type='copilot_action_execution' ORDER BY local_sequence",
        )
      ).map((c) => JSON.parse(c.payload_json).version),
    ).toEqual([1, 2]);
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("preserves a pending withdrawal when an old confirmation ack or pull arrives", async () => {
  const f = await actionExecutionFixture();
  try {
    let s = await f.repository.open(f.actionCard);
    s = await f.repository.save(f.actionCard, s.review);
    const first = s.link!;
    s = await f.repository.save(f.actionCard, s.review, true);
    await applyActionExecutionRecord(f.db, f.actionScope, first, 1);
    expect((await f.repository.open(f.actionCard)).link?.version).toBe(2);
    await applyActionExecutionRecord(f.db, f.actionScope, s.link!, 2);
    expect((await f.repository.open(f.actionCard)).syncState).toBe("SYNCED");
  } finally {
    f.db.db.close();
  }
});
it.each(["OWNER", "PERMISSION", "FORGED", "UNSYNCED", "HIDDEN", "ABORT"])(
  "refuses unsafe confirmation %s without a new command",
  async (mode) => {
    const f = await actionExecutionFixture();
    try {
      let card = f.actionCard,
        repo = f.repository;
      const controller = new AbortController();
      if (mode === "OWNER")
        repo = new CopilotActionExecutionRepository(
          f.db,
          { ...f.actionScope, ownerId: randomUUID() },
          decisionDigest,
          randomUUID,
        );
      if (mode === "PERMISSION")
        repo = new CopilotActionExecutionRepository(
          f.db,
          { ...f.actionScope, canRecord: false },
          decisionDigest,
          randomUUID,
        );
      if (mode === "FORGED")
        card = copilotMessageSchema.parse({
          ...card,
          text: card.text.replace("Îlot entrée", "TG fond"),
        });
      if (mode === "UNSYNCED")
        await f.db.runAsync(
          "UPDATE copilot_messages SET sync_state='PENDING' WHERE id=?",
          card.id,
        );
      if (mode === "HIDDEN")
        await f.db.runAsync(
          "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
          JSON.stringify({
            ...f.conversation,
            deletedMessageIds: [f.source.id],
          }),
          f.conversation.id,
        );
      if (mode === "ABORT") controller.abort();
      await expect(
        (async () => {
          const s = await repo.open(card);
          return repo.save(card, s.review, false, controller.signal);
        })(),
      ).rejects.toThrow();
      expect(
        await f.db.getAllAsync("SELECT * FROM action_executions"),
      ).toHaveLength(0);
    } finally {
      f.db.db.close();
    }
  },
);
it("rolls the declaration and outbox back together when enqueue fails", async () => {
  const f = await actionExecutionFixture();
  try {
    const s = await f.repository.open(f.actionCard),
      spy = vi
        .spyOn(OutboxRepository.prototype, "enqueue")
        .mockRejectedValueOnce(Error("unavailable"));
    await expect(f.repository.save(f.actionCard, s.review)).rejects.toThrow();
    spy.mockRestore();
    expect(
      await f.db.getAllAsync("SELECT * FROM action_executions"),
    ).toHaveLength(0);
  } finally {
    f.db.db.close();
  }
});
it("rejects forged source identity, incoherent lifecycle and unrelated read-page records", async () => {
  const f = await actionExecutionFixture();
  try {
    const s = await f.repository.open(f.actionCard),
      e = (await f.repository.save(f.actionCard, s.review)).link!;
    expect(actionExecutionSchema.safeParse({ ...e, version: 2 }).success).toBe(
      false,
    );
    expect(
      actionExecutionSchema.safeParse({ ...e, decisionId: randomUUID() })
        .success,
    ).toBe(false);
    expect(
      actionExecutionsReadResultSchema.safeParse({
        input: { recommendationId: randomUUID(), afterId: null, limit: 1 },
        entries: [e],
        hasMore: false,
        nextAfterId: null,
        evidence: f.preview.evidence,
      }).success,
    ).toBe(false);
  } finally {
    f.db.db.close();
  }
});

it("keeps failed declarations private in local diagnostics", async () => {
  const f = await actionExecutionFixture();
  try {
    const review = await f.repository.open(f.actionCard);
    await f.repository.save(f.actionCard, review.review);
    const outbox = new OutboxRepository(f.db),
      command = (await outbox.listPending(f.storeId))[0]!;
    await outbox.markSyncing(command.commandId);
    await outbox.markFailed(
      command.commandId,
      "COPILOT_ACTION_EXECUTION_LIMIT",
    );
    expect((await outbox.listFailures(f.storeId, randomUUID())).items).toEqual(
      [],
    );
    expect(
      (await outbox.listFailures(f.storeId, f.ownerId)).items,
    ).toHaveLength(1);
  } finally {
    f.db.db.close();
  }
});
