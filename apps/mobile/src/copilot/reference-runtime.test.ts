import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  copilotMessageSchema,
  readCopilotReferenceProposal,
  referenceSaveIntent,
} from "@fl-copilot/domain";
import { referencePreviewFixture } from "../../../../scripts/test-reference-preview-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { testChoiceDigest } from "../../../../scripts/test-commercial-choice-fixtures";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { applyCommercialVisualReading } from "../commercial/visual-repository";
import {
  CommercialVersionDecisionRepository,
  applyCommercialVersionDecision,
} from "../commercial/version-decision-repository";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "./conversation-repository";
import { CopilotReferenceController } from "./reference-controller";
import { CopilotReferenceRuntime } from "./reference-runtime";
class Adapter implements OutboxDatabase {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      if (this.fail) throw Error("private database error");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

async function setup(existing = false, path = ":memory:") {
  const data = await referencePreviewFixture(existing),
    chat = chatFixture(randomUUID),
    db = new DatabaseSync(path),
    a = new Adapter(db),
    deviceId = randomUUID();
  chat.storeId = data.f.storeId;
  chat.conversation.storeId = chat.storeId;
  chat.message.storeId = chat.storeId;
  chat.message.attachments = [];
  chat.message.text = "Je préfère le PDF corrigé après comparaison.";
  await runLocalMigrations(a);
  const repo = new CopilotConversationRepository(a, chat);
  await repo.save(chat.conversation, { commandId: randomUUID(), deviceId });
  await repo.append(chat.message, { commandId: randomUUID(), deviceId });
  await applyCommercialVisualReading(a, chat.storeId, data.f.reading);
  await applyCommercialVisualReading(a, chat.storeId, data.g.reading);
  if (existing)
    await applyCommercialVersionDecision(a, chat.storeId, data.decision);
  const assistant = copilotMessageSchema.parse({
      ...chat.message,
      id: randomUUID(),
      role: "ASSISTANT",
      text: "Voici le choix à confirmer.",
      replyToMessageId: chat.message.id,
      createdAt: "2026-10-11T12:01:00.000Z",
    }),
    message = copilotMessageSchema.parse({
      ...assistant,
      id: randomUUID(),
      role: "TOOL",
      text: JSON.stringify({
        kind: "COMMERCIAL_REFERENCE_PROPOSAL",
        schemaVersion: 1,
        assistantMessageId: assistant.id,
        input: data.input,
        basis: data.basis,
      }),
      createdAt: "2026-10-11T12:01:00.001Z",
    });
  await a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, chat, "copilot_message", assistant);
    await applyCopilotRecord(tx, chat, "copilot_message", message);
  });
  const scope = {
    storeId: chat.storeId,
    ownerId: chat.ownerId,
    deviceId,
    canManageCommercialReferences: true,
  };
  const controller = new CopilotReferenceController(
      a,
      scope,
      testChoiceDigest,
      randomUUID,
    ),
    runtime = new CopilotReferenceRuntime(a, testChoiceDigest, randomUUID),
    request = readCopilotReferenceProposal(message).request;
  const authority = {
    ...scope,
    comparisonReviewed: true,
    conversationId: chat.conversation.id,
    userMessageId: chat.message.id,
    authorizedRequestJson: referenceSaveIntent(request),
    decisionLevel: "REVIEWED" as const,
  };
  return {
    data,
    chat,
    db,
    a,
    scope,
    controller,
    runtime,
    request,
    authority,
    message,
    assistant,
    repo,
    deviceId,
  };
}
it.each([false, true])(
  "records a reviewed reference offline, preserves notes/history and replays exactly once after restart (existing=%s)",
  async (existing) => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-reference-")),
      path = join(dir, "local.db"),
      s = await setup(existing, path);
    let reopened: DatabaseSync | undefined;
    try {
      expect((await s.controller.open(s.message)).status).toBe("READY");
      await expect(s.controller.confirm(s.message, false)).rejects.toThrow(
        "REVIEW_REQUIRED",
      );
      expect((await s.controller.confirm(s.message, true)).status).toBe(
        "COMPLETED",
      );
      const choice = await new CommercialVersionDecisionRepository(
        s.a,
        testChoiceDigest,
      ).get(
        s.chat.storeId,
        s.data.f.sourceDocumentId,
        s.data.g.sourceDocumentId,
      );
      expect(choice?.entity.preference).toBe("PREFER_NEW");
      expect(choice?.entity.version).toBe(existing ? 2 : 1);
      expect(choice?.entity.note).toBe(existing ? s.data.decision.note : "");
      s.db.close();
      reopened = new DatabaseSync(path);
      const a = new Adapter(reopened),
        again = new CopilotReferenceController(
          a,
          s.scope,
          testChoiceDigest,
          randomUUID,
        );
      expect((await again.confirm(s.message, true)).status).toBe("COMPLETED");
      expect(
        reopened
          .prepare("SELECT COUNT(*) n FROM commercial_version_decision_history")
          .get(),
      ).toEqual({ n: 1 });
      expect(
        reopened
          .prepare(
            "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_VERSION_DECISION_UPSERT'",
          )
          .get(),
      ).toEqual({ n: 1 });
      for (const table of [
        "commercial_week_plans",
        "commercial_week_preparations",
        "commercial_offer_choices",
        "commercial_execution_tasks",
      ])
        expect(
          reopened.prepare(`SELECT COUNT(*) n FROM ${table}`).get(),
        ).toEqual({ n: 0 });
      const forbidden = new CopilotReferenceController(
        a,
        { ...s.scope, canManageCommercialReferences: false },
        testChoiceDigest,
        randomUUID,
      );
      await expect(forbidden.confirm(s.message, true)).rejects.toThrow(
        "FORBIDDEN",
      );
    } finally {
      reopened?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
it("rolls back reference, audit, Outbox and journal on failed commit and cancellation", async () => {
  const s = await setup();
  try {
    s.a.fail = true;
    await expect(s.controller.confirm(s.message, true)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    s.a.fail = false;
    const cancel = new AbortController();
    cancel.abort();
    await expect(
      s.controller.confirm(s.message, true, cancel.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    for (const table of [
      "commercial_version_decisions",
      "commercial_version_decision_history",
      "copilot_tool_results",
    ])
      expect(s.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({
        n: 0,
      });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_VERSION_DECISION_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect((await s.controller.confirm(s.message, true)).status).toBe(
      "COMPLETED",
    );
  } finally {
    s.db.close();
  }
});
it.each(["MISSING", "CHECKSUM", "FAILED", "COUNTS", "PREVIOUS", "CONFLICT"])(
  "rejects a stale %s basis instead of changing a reference",
  async (kind) => {
    const s = await setup();
    try {
      const p = s.data.g.reading;
      if (kind === "MISSING")
        s.db
          .prepare("DELETE FROM commercial_visual_readings WHERE id=?")
          .run(p.id);
      if (kind === "CHECKSUM")
        s.db
          .prepare(
            "UPDATE commercial_visual_readings SET payload_json=? WHERE id=?",
          )
          .run(JSON.stringify({ ...p, checksum: "changed" }), p.id);
      if (kind === "FAILED")
        s.db
          .prepare(
            "UPDATE commercial_visual_readings SET payload_json=? WHERE id=?",
          )
          .run(JSON.stringify({ ...p, status: "FAILED", reading: null }), p.id);
      if (kind === "COUNTS")
        s.db
          .prepare(
            "UPDATE commercial_visual_readings SET payload_json=? WHERE id=?",
          )
          .run(
            JSON.stringify({ ...p, reading: { ...p.reading, operations: [] } }),
            p.id,
          );
      if (kind === "PREVIOUS" || kind === "CONFLICT")
        await applyCommercialVersionDecision(
          s.a,
          s.chat.storeId,
          s.data.decision,
        );
      if (kind === "CONFLICT")
        s.db
          .prepare(
            "UPDATE commercial_version_decisions SET sync_state='CONFLICT' WHERE id=?",
          )
          .run(s.data.decision.id);
      expect((await s.controller.open(s.message)).status).toBe("STALE");
      await expect(s.controller.confirm(s.message, true)).rejects.toThrow(
        "STALE",
      );
      await expect(s.runtime.execute(s.request, s.authority)).rejects.toThrow();
      expect(
        s.db
          .prepare("SELECT COUNT(*) n FROM commercial_version_decision_history")
          .get(),
      ).toEqual({ n: 0 });
    } finally {
      s.db.close();
    }
  },
);
it("refuses foreign scope, forged cards, unreviewed authority and deleted private replies", async () => {
  const s = await setup();
  try {
    await expect(
      new CopilotReferenceController(
        s.a,
        { ...s.scope, storeId: randomUUID() },
        testChoiceDigest,
        randomUUID,
      ).open(s.message),
    ).rejects.toThrow();
    await expect(
      s.controller.confirm(
        {
          ...s.message,
          text: s.message.text.replace("S41-original.pdf", "fake.pdf"),
        },
        true,
      ),
    ).rejects.toThrow();
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority,
        comparisonReviewed: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const forged = {
      ...s.request,
      input: {
        ...s.request.input,
        basis: { ...s.request.input.basis, beforeFilename: "fake.pdf" },
      },
    };
    await expect(
      s.runtime.execute(forged, {
        ...s.authority,
        authorizedRequestJson: referenceSaveIntent(forged),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await s.repo.save(
      {
        ...s.chat.conversation,
        version: 2,
        updatedAt: "2026-10-11T12:02:00.000Z",
        deletedMessageIds: [s.assistant.id],
      },
      { commandId: randomUUID(), deviceId: s.deviceId },
    );
    await expect(s.controller.confirm(s.message, true)).rejects.toThrow(
      "UNAVAILABLE",
    );
    await expect(s.runtime.execute(s.request, s.authority)).rejects.toThrow();
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_version_decisions").get(),
    ).toEqual({ n: 0 });
  } finally {
    s.db.close();
  }
});
