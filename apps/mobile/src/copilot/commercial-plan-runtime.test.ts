import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  planValidateIntent,
  planPreviewResultSchema,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotCommercialPlanRuntime } from "./commercial-plan-runtime";
import { CopilotToolRuntime } from "./tool-runtime";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import { testChoiceDigest } from "../../../../scripts/test-commercial-choice-fixtures";
import { applyCommercialVisualReading } from "../commercial/visual-repository";
import { applyCommercialChoice } from "../commercial/offer-choice-repository";
import { applyCommercialPreparation } from "../commercial/week-preparation-repository";
import { applyValidatedOffer } from "../commercial/validated-offer-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
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

async function setup(path = ":memory:") {
  const db = new DatabaseSync(path),
    a = new Adapter(db),
    f = chatFixture(randomUUID),
    fixture = await commercialPlanFixture(),
    deviceId = randomUUID();
  f.storeId = fixture.storeId;
  f.conversation.storeId = fixture.storeId;
  f.message.storeId = fixture.storeId;
  await runLocalMigrations(a);
  const c = new CopilotConversationRepository(a, f);
  await c.save(f.conversation, { commandId: randomUUID(), deviceId });
  await c.append(
    {
      ...f.message,
      text: "Je valide cet aperçu du plan.",
      createdAt: "2026-10-11T12:02:00Z",
      attachments: [],
    },
    { commandId: randomUUID(), deviceId },
  );
  await new ProductMasterRepository(a).upsertProduct(fixture.product, {
    commandId: randomUUID(),
    deviceId,
  });
  await applyCommercialVisualReading(a, f.storeId, fixture.reading);
  await applyCommercialChoice(a, f.storeId, fixture.choice);
  await applyCommercialPreparation(a, f.storeId, fixture.preparation);
  await applyValidatedOffer(a, f.storeId, fixture.validated);
  const scope = {
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    canReadStore: true,
  };
  const previewRequest = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "commercial.plan.preview",
    input: { weekStart: fixture.preparation.weekStart },
  };
  const request = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "commercial.plan.validate",
    input: { previewOperationId: previewRequest.operationId },
  };
  const authority = (r: unknown) => ({
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    deviceId,
    canValidateCommercialPlan: true,
    userMessageId: f.message.id,
    authorizedRequestJson: planValidateIntent(r),
    decisionLevel: "REVIEWED" as const,
  });
  const reader = new CopilotToolRuntime(
      a,
      () => "2026-10-11T12:01:00Z",
      testChoiceDigest,
    ),
    runtime = new CopilotCommercialPlanRuntime(
      a,
      testChoiceDigest,
      randomUUID,
      () => "2026-10-11T12:02:00Z",
    );
  return {
    db,
    a,
    f,
    fixture,
    scope,
    previewRequest,
    request,
    authority,
    reader,
    runtime,
  };
}
it("previews without business writes and validates the reviewed plan exactly once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-plan-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const count = s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get();
    const preview = planPreviewResultSchema.parse(
      await s.reader.execute(s.previewRequest, s.scope),
    );
    expect(preview.issues).toEqual([]);
    expect(preview.candidate?.status).toBe("VALIDATED");
    expect(s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual(
      count,
    );
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get(),
    ).toEqual({ n: 0 });
    const saved = await s.runtime.execute(s.request, s.authority(s.request));
    expect(saved.after.validatedAt).toBe("2026-10-11T12:02:00Z");
    expect(saved.after.productRefs).toEqual(preview.candidate?.productRefs);
    expect(saved.after.offers).toHaveLength(1);
    s.db.close();
    reopened = new DatabaseSync(path);
    const r = new CopilotCommercialPlanRuntime(
      new Adapter(reopened),
      testChoiceDigest,
      randomUUID,
    );
    expect(await r.execute(s.request, s.authority(s.request))).toEqual(saved);
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM commercial_plan_history").get(),
    ).toEqual({ n: 1 });
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_plan_revisions")
        .get(),
    ).toEqual({ n: 0 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_WEEK_PLAN_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 1 });
    const reused = { ...s.request, operationId: randomUUID() };
    await expect(r.execute(reused, s.authority(reused))).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    await expect(
      r.execute(s.request, {
        ...s.authority(s.request),
        canValidateCommercialPlan: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("exposes missing validation and refuses incomplete, absent or foreign previews", async () => {
  const s = await setup();
  try {
    await expect(
      s.runtime.execute(s.request, s.authority(s.request)),
    ).rejects.toMatchObject({ code: "COMMERCIAL_PLAN_REVIEW_REQUIRED" });
    s.db.exec("DELETE FROM commercial_validated_offers");
    const preview = planPreviewResultSchema.parse(
      await s.reader.execute(s.previewRequest, s.scope),
    );
    expect(preview.candidate).toBeNull();
    expect(preview.issues.length).toBeGreaterThan(0);
    await expect(
      s.runtime.execute(s.request, s.authority(s.request)),
    ).rejects.toMatchObject({ code: "COMMERCIAL_PLAN_REVIEW_REQUIRED" });
    await expect(
      s.reader.execute(s.previewRequest, { ...s.scope, ownerId: randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const next = {
      ...s.previewRequest,
      operationId: randomUUID(),
      input: { weekStart: "2026-10-12" },
    };
    expect(
      planPreviewResultSchema.parse(await s.reader.execute(next, s.scope))
        .issues[0]?.code,
    ).toBe("PREPARATION_MISSING");
  } finally {
    s.db.close();
  }
});
it("requires a fresh review after a product, preparation or choice change", async () => {
  for (const kind of ["product", "preparation", "choice"]) {
    const s = await setup();
    try {
      await s.reader.execute(s.previewRequest, s.scope);
      if (kind === "product")
        s.db.prepare("UPDATE products SET version=version+1").run();
      else {
        const table =
            kind === "preparation"
              ? "commercial_week_preparations"
              : "commercial_offer_choices",
          row = s.db.prepare(`SELECT payload_json FROM ${table}`).get() as {
            payload_json: string;
          },
          entity = JSON.parse(row.payload_json);
        entity.version++;
        s.db
          .prepare(`UPDATE ${table} SET payload_json=?`)
          .run(JSON.stringify(entity));
      }
      await expect(
        s.runtime.execute(s.request, s.authority(s.request)),
      ).rejects.toMatchObject({ code: "COMMERCIAL_PLAN_REVIEW_REQUIRED" });
      expect(
        s.db.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get(),
      ).toEqual({ n: 0 });
    } finally {
      s.db.close();
    }
  }
});
it("rolls back plan materialization, history, revision and outbox on failure or cancellation", async () => {
  const s = await setup();
  try {
    await s.reader.execute(s.previewRequest, s.scope);
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        decisionLevel: "ROUTINE",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    s.a.fail = true;
    await expect(
      s.runtime.execute(s.request, s.authority(s.request)),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    s.a.fail = false;
    const controller = new AbortController();
    controller.abort();
    await expect(
      s.runtime.execute(s.request, s.authority(s.request), controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    for (const t of [
      "commercial_week_plans",
      "commercial_plan_history",
      "commercial_plan_revisions",
    ])
      expect(s.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({
        n: 0,
      });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_WEEK_PLAN_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get(),
    ).toEqual({ n: 1 });
  } finally {
    s.db.close();
  }
});
it("does not use a message predating the preview as acceptance", async () => {
  const s = await setup();
  try {
    await s.reader.execute(s.previewRequest, s.scope);
    const row = s.db
        .prepare("SELECT payload_json FROM copilot_messages WHERE id=?")
        .get(s.f.message.id) as { payload_json: string },
      m = JSON.parse(row.payload_json);
    m.createdAt = "2026-10-11T12:00:00Z";
    s.db
      .prepare("UPDATE copilot_messages SET payload_json=? WHERE id=?")
      .run(JSON.stringify(m), s.f.message.id);
    await expect(
      s.runtime.execute(s.request, s.authority(s.request)),
    ).rejects.toMatchObject({ code: "COMMERCIAL_PLAN_REVIEW_REQUIRED" });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_plan_history").get(),
    ).toEqual({ n: 0 });
  } finally {
    s.db.close();
  }
});

async function planCard(s: Awaited<ReturnType<typeof setup>>) {
  const { readCopilotContext } = await import("./context-readers"),
    { copilotMessageSchema } = await import("@fl-copilot/domain"),
    { applyCopilotRecord } = await import("./conversation-repository");
  const content = await readCopilotContext(
    s.a,
    s.f.storeId,
    {
      ...s.previewRequest,
      schemaVersion: 1 as const,
      tool: "commercial.plan.preview" as const,
    },
    "2026-10-11T12:03:00.000Z",
    testChoiceDigest,
  );
  const preview = planPreviewResultSchema.parse({
    ...content,
    operationId: s.previewRequest.operationId,
    schemaVersion: 1,
    tool: "commercial.plan.preview",
    status: "COMPLETED",
    observedAt: "2026-10-11T12:03:00.000Z",
  });
  const assistant = copilotMessageSchema.parse({
    ...s.f.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: s.f.message.id,
    text: "Voici le plan à confirmer.",
    attachments: [],
    createdAt: "2026-10-11T12:04:00.000Z",
  });
  const message = copilotMessageSchema.parse({
    ...assistant,
    id: randomUUID(),
    role: "TOOL",
    createdAt: "2026-10-11T12:04:00.001Z",
    text: JSON.stringify({
      kind: "PLAN_VALIDATION_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      preview,
    }),
  });
  await s.a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, s.f, "copilot_message", assistant);
    await applyCopilotRecord(tx, s.f, "copilot_message", message);
  });
  return message;
}
async function planController(
  s: Awaited<ReturnType<typeof setup>>,
  allowed = true,
) {
  const { CopilotPlanValidationController } =
    await import("./plan-validation-controller");
  return new CopilotPlanValidationController(
    s.a,
    { ...s.authority(s.request), canValidateCommercialPlan: allowed },
    testChoiceDigest,
    randomUUID,
    () => "2026-10-11T12:05:00.000Z",
  );
}
it("confirms a synced native card atomically with a new reviewed user message and once-only replay after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-plan-card-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const message = await planCard(s),
      controller = await planController(s);
    await new CopilotConversationRepository(s.a, s.f).saveDraft(
      s.f.conversation.id,
      {
        text: "Question suivante conservée",
        attachments: [],
        updatedAt: "2026-10-11T12:04:00.000Z",
      },
    );
    expect((await controller.open(message)).status).toBe("READY");
    await expect(controller.confirm(message, false)).rejects.toThrow(
      "REVIEW_REQUIRED",
    );
    expect((await controller.confirm(message, true)).status).toBe("COMPLETED");
    const draft = s.db
      .prepare(
        "SELECT payload_json FROM copilot_drafts WHERE conversation_id=?",
      )
      .get(s.f.conversation.id) as { payload_json: string };
    expect(JSON.parse(draft.payload_json).text).toBe(
      "Question suivante conservée",
    );
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_plan_history").get(),
    ).toEqual({ n: 1 });
    const row = s.db
      .prepare(
        "SELECT result_json FROM copilot_tool_results WHERE operation_id=?",
      )
      .get(message.id) as { result_json: string };
    const result = JSON.parse(row.result_json);
    expect(result.after.validatedAt).toBe("2026-10-11T12:05:00.000Z");
    expect(result.userMessageId).not.toBe(s.f.message.id);
    const user = s.db
      .prepare("SELECT payload_json FROM copilot_messages WHERE id=?")
      .get(result.userMessageId) as { payload_json: string };
    expect(JSON.parse(user.payload_json)).toMatchObject({
      role: "USER",
      createdAt: "2026-10-11T12:05:00.000Z",
    });
    s.db.close();
    reopened = new DatabaseSync(path);
    const { CopilotPlanValidationController } =
      await import("./plan-validation-controller");
    const again = new CopilotPlanValidationController(
      new Adapter(reopened),
      s.authority(s.request),
      testChoiceDigest,
      randomUUID,
    );
    expect((await again.confirm(message, true)).status).toBe("COMPLETED");
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM commercial_plan_history").get(),
    ).toEqual({ n: 1 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_WEEK_PLAN_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 1 });
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_execution_tasks")
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rolls back native confirmation, preview journal, plan and Outbox together", async () => {
  const s = await setup();
  try {
    const message = await planCard(s),
      controller = await planController(s);
    const count = s.db.prepare("SELECT COUNT(*) n FROM copilot_messages").get();
    s.a.fail = true;
    await expect(controller.confirm(message, true)).rejects.toThrow();
    s.a.fail = false;
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_messages").get(),
    ).toEqual(count);
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get(),
    ).toEqual({ n: 0 });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get(),
    ).toEqual({ n: 0 });
    expect((await controller.confirm(message, true)).status).toBe("COMPLETED");
  } finally {
    s.db.close();
  }
});
it.each([
  "PREPARATION",
  "PRODUCT",
  "CHOICE",
  "SOURCE",
  "UNIT",
  "PLAN",
  "VALIDATION",
  "CONFLICT",
])(
  "refuses stale %s instead of adopting new data at native confirmation",
  async (kind) => {
    const s = await setup();
    try {
      const message = await planCard(s),
        controller = await planController(s);
      if (kind === "VALIDATION")
        s.db
          .prepare("DELETE FROM commercial_validated_offers WHERE id=?")
          .run(s.fixture.validated.id);
      if (kind === "CONFLICT")
        s.db
          .prepare("UPDATE products SET sync_state='CONFLICT' WHERE id=?")
          .run(s.fixture.product.id);
      if (kind === "UNIT")
        s.db
          .prepare("UPDATE products SET sales_unit='PIECE' WHERE id=?")
          .run(s.fixture.product.id);
      if (kind === "PRODUCT")
        s.db
          .prepare("UPDATE products SET version=version+1 WHERE id=?")
          .run(s.fixture.product.id);
      if (kind === "PREPARATION")
        await applyCommercialPreparation(s.a, s.f.storeId, {
          ...s.fixture.preparation,
          version: 2,
          note: "Nouvelle préparation",
        });
      if (kind === "CHOICE")
        await applyCommercialChoice(s.a, s.f.storeId, {
          ...s.fixture.choice,
          version: 2,
        });
      if (kind === "SOURCE")
        s.db
          .prepare(
            "UPDATE commercial_visual_readings SET payload_json=? WHERE id=?",
          )
          .run(
            JSON.stringify({ ...s.fixture.reading, checksum: "changed" }),
            s.fixture.reading.id,
          );
      if (kind === "PLAN") {
        await s.reader.execute(s.previewRequest, s.scope);
        await s.runtime.execute(s.request, s.authority(s.request));
      }
      expect((await controller.open(message)).status).toBe("STALE");
      await expect(controller.confirm(message, true)).rejects.toThrow("STALE");
    } finally {
      s.db.close();
    }
  },
);
it("rejects revoked permission, forged cards, deleted replies and cancellation without recording a plan", async () => {
  const s = await setup();
  try {
    const message = await planCard(s),
      controller = await planController(s);
    await expect(
      (await planController(s, false)).confirm(message, true),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      controller.confirm(
        { ...message, text: message.text.replace("TG entrée", "TG modifiée") },
        true,
      ),
    ).rejects.toThrow();
    const cancel = new AbortController();
    cancel.abort();
    await expect(
      controller.confirm(message, true, cancel.signal),
    ).rejects.toThrow("CANCELLED");
    const content = JSON.parse(message.text);
    const repo = new CopilotConversationRepository(s.a, s.f);
    await repo.save(
      {
        ...s.f.conversation,
        version: 2,
        updatedAt: "2026-10-11T12:06:00.000Z",
        deletedMessageIds: [content.assistantMessageId],
      },
      { commandId: randomUUID(), deviceId: s.authority(s.request).deviceId },
    );
    await expect(controller.confirm(message, true)).rejects.toThrow(
      "UNAVAILABLE",
    );
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get(),
    ).toEqual({ n: 0 });
  } finally {
    s.db.close();
  }
});
