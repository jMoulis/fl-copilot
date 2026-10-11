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
