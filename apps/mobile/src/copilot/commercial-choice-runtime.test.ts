import { CopilotToolRuntime } from "./tool-runtime";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  choiceSaveIntent,
  choiceInspectResultSchema,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotCommercialChoiceRuntime } from "./commercial-choice-runtime";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  commercialChoiceFixture,
  testChoiceDigest,
} from "../../../../scripts/test-commercial-choice-fixtures";
import { applyCommercialVisualReading } from "../commercial/visual-repository";
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
    deviceId = randomUUID();
  await runLocalMigrations(a);
  const c = new CopilotConversationRepository(a, f);
  await c.save(f.conversation, { commandId: randomUUID(), deviceId });
  await c.append(
    {
      ...f.message,
      text: "Retiens cette offre pour la semaine.",
      attachments: [],
    },
    { commandId: randomUUID(), deviceId },
  );
  const fixture = await commercialChoiceFixture({ storeId: f.storeId });
  await applyCommercialVisualReading(a, f.storeId, fixture.reading);
  await new ProductMasterRepository(a).upsertProduct(fixture.product, {
    commandId: randomUUID(),
    deviceId,
  });
  const {
    id: _id,
    storeId: _store,
    version: _version,
    createdAt: _created,
    updatedAt: _updated,
    ...draft
  } = fixture.choice;
  void _id;
  void _store;
  void _version;
  void _created;
  void _updated;
  const request = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "commercial.choice.save",
    input: {
      expectedVersion: null as number | null,
      productVersion: 1 as number | null,
      draft,
    },
  };
  const authority = (r: unknown) => ({
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    deviceId,
    canManageCommercialChoices: true,
    userMessageId: f.message.id,
    authorizedRequestJson: choiceSaveIntent(r),
    decisionLevel: "REVIEWED" as const,
  });
  const runtime = new CopilotCommercialChoiceRuntime(
    a,
    testChoiceDigest,
    randomUUID,
    () => "2026-10-11T12:00:00Z",
  );
  return { db, a, f, fixture, request, authority, runtime };
}
it("retains offline, replays once after restart and withdraws preserving historical offer facts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-choice-")),
    s = await setup(join(dir, "local.db"));
  let reopened: DatabaseSync | undefined;
  try {
    const original = JSON.stringify(
      s.db.prepare("SELECT * FROM commercial_visual_readings").get(),
    );
    const result = await s.runtime.execute(s.request, s.authority(s.request));
    expect(result.after.id).toBe(s.fixture.choice.id);
    expect(result.after.version).toBe(1);
    expect(
      JSON.stringify(
        s.db.prepare("SELECT * FROM commercial_visual_readings").get(),
      ),
    ).toBe(original);
    s.db.close();
    reopened = new DatabaseSync(join(dir, "local.db"));
    const a = new Adapter(reopened),
      r = new CopilotCommercialChoiceRuntime(a, testChoiceDigest, randomUUID);
    expect(await r.execute(s.request, s.authority(s.request))).toEqual(result);
    const withdraw = {
      ...s.request,
      operationId: randomUUID(),
      input: {
        ...s.request.input,
        expectedVersion: 1,
        productVersion: null,
        draft: { ...s.request.input.draft, status: "WITHDRAWN" as const },
      },
    };
    const removed = await r.execute(withdraw, s.authority(withdraw));
    expect(removed.after.status).toBe("WITHDRAWN");
    expect(removed.after.createdAt).toBe(result.after.createdAt);
    expect(removed.after.mechanism).toEqual(result.after.mechanism);
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_choice_history")
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened
        .prepare(
          "SELECT expected_remote_version FROM sync_outbox WHERE command_type='COMMERCIAL_OFFER_CHOICE_UPSERT' ORDER BY local_sequence",
        )
        .all(),
    ).toEqual([
      { expected_remote_version: null },
      { expected_remote_version: 1 },
    ]);
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get(),
    ).toEqual({ n: 0 });
  } finally {
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rejects forged source labels, foreign products, stale versions and unreviewed or revoked permission", async () => {
  const s = await setup();
  try {
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        decisionLevel: "ROUTINE",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    const forged = {
      ...s.request,
      input: {
        ...s.request.input,
        draft: { ...s.request.input.draft, rawProductLabel: "Offre inventée" },
      },
    };
    await expect(
      s.runtime.execute(forged, s.authority(forged)),
    ).rejects.toMatchObject({ code: "COMMERCIAL_SOURCE_INVALID" });
    const foreign = {
      ...s.request,
      input: {
        ...s.request.input,
        draft: { ...s.request.input.draft, productId: randomUUID() },
      },
    };
    await expect(
      s.runtime.execute(foreign, s.authority(foreign)),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    const staleProduct = {
      ...s.request,
      input: { ...s.request.input, productVersion: 2 },
    };
    await expect(
      s.runtime.execute(staleProduct, s.authority(staleProduct)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await s.runtime.execute(s.request, s.authority(s.request));
    const stale = { ...s.request, operationId: randomUUID() };
    await expect(
      s.runtime.execute(stale, s.authority(stale)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        canManageCommercialChoices: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        ownerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    s.db.close();
  }
});
it("rolls back all choice writes on commit failure/cancellation and refuses nonexistent withdrawal", async () => {
  const s = await setup();
  try {
    const withdraw = {
      ...s.request,
      input: {
        ...s.request.input,
        productVersion: null,
        draft: { ...s.request.input.draft, status: "WITHDRAWN" as const },
      },
    };
    await expect(
      s.runtime.execute(withdraw, s.authority(withdraw)),
    ).rejects.toMatchObject({ code: "COMMERCIAL_CHOICE_UNAVAILABLE" });
    s.a.fail = true;
    await expect(
      s.runtime.execute(s.request, s.authority(s.request)),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    s.a.fail = false;
    const abort = new AbortController();
    abort.abort();
    await expect(
      s.runtime.execute(s.request, s.authority(s.request), abort.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    for (const t of [
      "commercial_offer_choices",
      "commercial_choice_history",
      "copilot_tool_results",
    ])
      expect(s.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({
        n: 0,
      });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_OFFER_CHOICE_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    s.db.close();
  }
});

it("inspects withdrawn choices, validates prices and preserves conflicts without silently resolving them", async () => {
  const s = await setup();
  try {
    const invalid = {
      ...s.request,
      input: {
        ...s.request.input,
        draft: {
          ...s.request.input.draft,
          mechanism: {
            type: "LOT",
            lotQuantity: 2,
            totalPrice: 10,
            unitPrice: 2,
            unit: "PIECE",
          },
        },
      },
    };
    await expect(
      s.runtime.execute(invalid, s.authority(invalid)),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const saved = await s.runtime.execute(s.request, s.authority(s.request));
    const w = {
      ...s.request,
      operationId: randomUUID(),
      input: {
        ...s.request.input,
        expectedVersion: 1,
        productVersion: null,
        draft: { ...s.request.input.draft, status: "WITHDRAWN" as const },
      },
    };
    await s.runtime.execute(w, s.authority(w));
    const scope = {
        storeId: s.f.storeId,
        ownerId: s.f.ownerId,
        conversationId: s.f.conversation.id,
        canReadStore: true,
      },
      r = new CopilotToolRuntime(s.a),
      read = {
        operationId: randomUUID(),
        schemaVersion: 1,
        tool: "commercial.choice.inspect",
        input: { choiceId: saved.after.id },
      };
    expect(
      choiceInspectResultSchema.parse(await r.execute(read, scope)).snapshot
        ?.entity.status,
    ).toBe("WITHDRAWN");
    await expect(
      r.execute(read, { ...scope, ownerId: randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const changedWithdrawal = {
      ...w,
      operationId: randomUUID(),
      input: {
        ...w.input,
        expectedVersion: 2,
        draft: { ...w.input.draft, productId: randomUUID() },
      },
    };
    await expect(
      s.runtime.execute(changedWithdrawal, s.authority(changedWithdrawal)),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    s.db
      .prepare("UPDATE commercial_offer_choices SET sync_state='CONFLICT'")
      .run();
    const retain = {
      ...s.request,
      operationId: randomUUID(),
      input: { ...s.request.input, expectedVersion: 2 },
    };
    await expect(
      s.runtime.execute(retain, s.authority(retain)),
    ).rejects.toMatchObject({ code: "SYNC_CONFLICT" });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_choice_history").get(),
    ).toEqual({ n: 2 });
  } finally {
    s.db.close();
  }
});

async function withdrawalCard(s: Awaited<ReturnType<typeof setup>>) {
  const { copilotMessageSchema } = await import("@fl-copilot/domain");
  const { applyCopilotRecord } = await import("./conversation-repository");
  const before = (await s.runtime.execute(s.request, s.authority(s.request)))
    .after;
  const assistant = copilotMessageSchema.parse({
    ...s.f.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: s.f.message.id,
    attachments: [],
  });
  const message = copilotMessageSchema.parse({
    ...assistant,
    id: randomUUID(),
    role: "TOOL",
    text: JSON.stringify({
      kind: "COMMERCIAL_CHOICE_WITHDRAWAL_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: { choiceId: before.id },
      before,
    }),
  });
  await s.a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, s.f, "copilot_message", assistant);
    await applyCopilotRecord(tx, s.f, "copilot_message", message);
  });
  return message;
}
async function withdrawalController(
  s: Awaited<ReturnType<typeof setup>>,
  allowed = true,
  db = s.a,
) {
  const { CopilotChoiceWithdrawalController } =
    await import("./choice-withdrawal-controller");
  return new CopilotChoiceWithdrawalController(
    db,
    {
      storeId: s.f.storeId,
      ownerId: s.f.ownerId,
      deviceId: s.authority(s.request).deviceId,
      canManageCommercialChoices: allowed,
    },
    testChoiceDigest,
    randomUUID,
  );
}
it("confirms a private withdrawal atomically, preserves sources and replays once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "withdraw-card-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const m = await withdrawalCard(s),
      c = await withdrawalController(s);
    expect((await c.open(m)).status).toBe("READY");
    const original = JSON.stringify(
      s.db.prepare("SELECT * FROM commercial_visual_readings").get(),
    );
    await expect(
      (await withdrawalController(s, false)).confirm(m),
    ).rejects.toThrow("FORBIDDEN");
    s.a.fail = true;
    await expect(c.confirm(m)).rejects.toThrow();
    s.a.fail = false;
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_choice_history").get(),
    ).toEqual({ n: 1 });
    await c.confirm(m);
    expect(
      JSON.stringify(
        s.db.prepare("SELECT * FROM commercial_visual_readings").get(),
      ),
    ).toBe(original);
    s.db.close();
    reopened = new DatabaseSync(path);
    expect(
      (
        await (
          await withdrawalController(s, true, new Adapter(reopened))
        ).confirm(m)
      ).status,
    ).toBe("COMPLETED");
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_choice_history")
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_OFFER_CHOICE_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get(),
    ).toEqual({ n: 0 });
  } finally {
    reopened?.close();
    try {
      s.db.close();
    } catch {
      /* closed */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
it("refuses stale, forged and cancelled private withdrawals", async () => {
  const s = await setup();
  try {
    const m = await withdrawalCard(s),
      c = await withdrawalController(s);
    await expect(
      c.confirm({ ...m, text: m.text.replace('"version":1', '"version":2') }),
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(c.confirm(m, abort.signal)).rejects.toThrow();
    const changed = {
      ...s.request,
      operationId: randomUUID(),
      input: {
        ...s.request.input,
        expectedVersion: 1,
        draft: { ...s.request.input.draft, note: "Autre changement" },
      },
    };
    await s.runtime.execute(changed, s.authority(changed));
    expect((await c.open(m)).status).toBe("STALE");
    await expect(c.confirm(m)).rejects.toThrow("STALE");
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_choice_history").get(),
    ).toEqual({ n: 2 });
  } finally {
    s.db.close();
  }
});

async function updateCard(
  s: Awaited<ReturnType<typeof setup>>,
  patch: unknown = { note: "Note depuis le chat" },
) {
  const { copilotMessageSchema } = await import("@fl-copilot/domain"),
    { applyCopilotRecord } = await import("./conversation-repository");
  const before = (await s.runtime.execute(s.request, s.authority(s.request)))
    .after;
  const product = (await new ProductMasterRepository(s.a).getProduct(
    before.productId,
  ))!.entity;
  const assistant = copilotMessageSchema.parse({
    ...s.f.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: s.f.message.id,
    attachments: [],
  });
  const message = copilotMessageSchema.parse({
    ...assistant,
    id: randomUUID(),
    role: "TOOL",
    text: JSON.stringify({
      kind: "COMMERCIAL_CHOICE_UPDATE_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: { choiceId: before.id, patch },
      basis: { before, product },
    }),
  });
  await s.a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, s.f, "copilot_message", assistant);
    await applyCopilotRecord(tx, s.f, "copilot_message", message);
  });
  return message;
}
async function updateController(
  s: Awaited<ReturnType<typeof setup>>,
  allowed = true,
  db = s.a,
) {
  const { CopilotChoiceUpdateController } =
    await import("./choice-update-controller");
  return new CopilotChoiceUpdateController(
    db,
    {
      storeId: s.f.storeId,
      ownerId: s.f.ownerId,
      deviceId: s.authority(s.request).deviceId,
      canManageCommercialChoices: allowed,
    },
    testChoiceDigest,
    randomUUID,
  );
}
it("saves a reviewed partial update atomically, preserves source/terms and replays once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "choice-edit-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const mechanism = {
      type: "PRICE_CEILING",
      amount: 3,
      currency: "EUR",
      unit: "KG",
      operator: "LESS_THAN",
    };
    const m = await updateCard(s, {
        note: "Note depuis le chat",
        saleEnd: "2026-10-12",
        mechanism,
      }),
      c = await updateController(s);
    expect((await c.open(m)).status).toBe("READY");
    const source = JSON.stringify(
      s.db.prepare("SELECT * FROM commercial_visual_readings").get(),
    );
    s.a.fail = true;
    await expect(c.confirm(m)).rejects.toThrow();
    s.a.fail = false;
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_choice_history").get(),
    ).toEqual({ n: 1 });
    await expect((await updateController(s, false)).confirm(m)).rejects.toThrow(
      "FORBIDDEN",
    );
    await c.confirm(m);
    const row = s.db
      .prepare("SELECT payload_json FROM commercial_offer_choices")
      .get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({
      source: s.fixture.choice.source,
      productId: s.fixture.product.id,
      mechanism,
      saleEnd: "2026-10-12",
      saleStart: s.fixture.choice.saleStart,
      note: "Note depuis le chat",
      status: "RETAINED",
      version: 2,
    });
    expect(
      JSON.stringify(
        s.db.prepare("SELECT * FROM commercial_visual_readings").get(),
      ),
    ).toBe(source);
    s.db.close();
    reopened = new DatabaseSync(path);
    expect(
      (
        await (
          await updateController(s, true, new Adapter(reopened))
        ).confirm(m)
      ).status,
    ).toBe("COMPLETED");
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_choice_history")
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_OFFER_CHOICE_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 2 });
  } finally {
    reopened?.close();
    try {
      s.db.close();
    } catch {
      /* closed */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rejects a reviewed edit when its product changes, a card is forged or the action is cancelled", async () => {
  const s = await setup();
  try {
    const m = await updateCard(s),
      c = await updateController(s);
    await expect(
      c.confirm({
        ...m,
        text: m.text.replace("Note depuis le chat", "Autre note"),
      }),
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(c.confirm(m, abort.signal)).rejects.toThrow();
    await new ProductMasterRepository(s.a).upsertProduct(
      { ...s.fixture.product, label: "Autre libellé", version: 2 },
      { commandId: randomUUID(), deviceId: s.authority(s.request).deviceId },
    );
    expect((await c.open(m)).status).toBe("STALE");
    await expect(c.confirm(m)).rejects.toThrow("STALE");
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_choice_history").get(),
    ).toEqual({ n: 1 });
  } finally {
    s.db.close();
  }
});

it("refuses incompatible price units through the canonical retained-choice writer", async () => {
  const s = await setup();
  try {
    await new ProductMasterRepository(s.a).upsertProduct(
      { ...s.fixture.product, salesUnit: "KG", version: 2 },
      { commandId: randomUUID(), deviceId: s.authority(s.request).deviceId },
    );
    const request = {
      ...s.request,
      operationId: randomUUID(),
      input: {
        ...s.request.input,
        productVersion: 2,
        draft: {
          ...s.request.input.draft,
          mechanism: {
            type: "FIXED_PRICE",
            amount: 2,
            currency: "EUR",
            unit: "PIECE",
          },
        },
      },
    };
    await expect(
      s.runtime.execute(request, s.authority(request)),
    ).rejects.toThrow("L’unité du prix");
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_offer_choices").get(),
    ).toEqual({ n: 0 });
  } finally {
    s.db.close();
  }
});

async function reassociationCard(
  s: Awaited<ReturnType<typeof setup>>,
  targetId = randomUUID(),
  missingOldProfile = false,
) {
  const { copilotMessageSchema } = await import("@fl-copilot/domain"),
    { applyCopilotRecord } = await import("./conversation-repository");
  const before = (await s.runtime.execute(s.request, s.authority(s.request)))
    .after;
  const previousProduct = (await new ProductMasterRepository(s.a).getProduct(
    before.productId,
  ))!.entity;
  await new ProductMasterRepository(s.a).upsertProduct(
    { ...previousProduct, id: targetId, label: "Produit cible", version: 1 },
    { commandId: randomUUID(), deviceId: s.authority(s.request).deviceId },
  );
  const product = (await new ProductMasterRepository(s.a).getProduct(targetId))!
    .entity;
  if (missingOldProfile)
    s.db.prepare("DELETE FROM products WHERE id=?").run(before.productId);
  const assistant = copilotMessageSchema.parse({
    ...s.f.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: s.f.message.id,
    attachments: [],
  });
  const message = copilotMessageSchema.parse({
    ...assistant,
    id: randomUUID(),
    role: "TOOL",
    text: JSON.stringify({
      kind: "COMMERCIAL_CHOICE_REASSOCIATION_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: { choiceId: before.id, productId: targetId },
      basis: {
        before,
        product,
        previousProduct: missingOldProfile ? null : previousProduct,
      },
    }),
  });
  await s.a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, s.f, "copilot_message", assistant);
    await applyCopilotRecord(tx, s.f, "copilot_message", message);
  });
  return message;
}
async function reassociationController(
  s: Awaited<ReturnType<typeof setup>>,
  allowed = true,
  db = s.a,
) {
  const { CopilotChoiceReassociationController } =
    await import("./choice-reassociation-controller");
  return new CopilotChoiceReassociationController(
    db,
    {
      storeId: s.f.storeId,
      ownerId: s.f.ownerId,
      deviceId: s.authority(s.request).deviceId,
      canManageCommercialChoices: allowed,
    },
    testChoiceDigest,
    randomUUID,
  );
}
it("reassociates a reviewed product atomically, preserves source/terms and replays once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "choice-edit-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const targetId = randomUUID(),
      m = await reassociationCard(s, targetId),
      c = await reassociationController(s);
    expect((await c.open(m)).status).toBe("READY");
    const source = JSON.stringify(
      s.db.prepare("SELECT * FROM commercial_visual_readings").get(),
    );
    s.a.fail = true;
    await expect(c.confirm(m)).rejects.toThrow();
    s.a.fail = false;
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_choice_history").get(),
    ).toEqual({ n: 1 });
    await expect(
      (await reassociationController(s, false)).confirm(m),
    ).rejects.toThrow("FORBIDDEN");
    await c.confirm(m);
    const row = s.db
      .prepare("SELECT payload_json FROM commercial_offer_choices")
      .get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({
      source: s.fixture.choice.source,
      productId: targetId,
      mechanism: s.fixture.choice.mechanism,
      saleEnd: s.fixture.choice.saleEnd,
      saleStart: s.fixture.choice.saleStart,
      note: s.fixture.choice.note,
      status: "RETAINED",
      version: 2,
    });
    expect(
      JSON.stringify(
        s.db.prepare("SELECT * FROM commercial_visual_readings").get(),
      ),
    ).toBe(source);
    s.db.close();
    reopened = new DatabaseSync(path);
    expect(
      (
        await (
          await reassociationController(s, true, new Adapter(reopened))
        ).confirm(m)
      ).status,
    ).toBe("COMPLETED");
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_choice_history")
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_OFFER_CHOICE_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 2 });
  } finally {
    reopened?.close();
    try {
      s.db.close();
    } catch {
      /* closed */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rejects a reviewed reassociation when the old product changes, a card is forged or the action is cancelled", async () => {
  const s = await setup();
  try {
    const m = await reassociationCard(s),
      c = await reassociationController(s);
    await expect(
      c.confirm({
        ...m,
        text: m.text.replace("Produit cible", "Autre produit"),
      }),
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(c.confirm(m, abort.signal)).rejects.toThrow();
    await new ProductMasterRepository(s.a).upsertProduct(
      { ...s.fixture.product, label: "Autre libellé", version: 2 },
      { commandId: randomUUID(), deviceId: s.authority(s.request).deviceId },
    );
    expect((await c.open(m)).status).toBe("STALE");
    await expect(c.confirm(m)).rejects.toThrow("STALE");
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_choice_history").get(),
    ).toEqual({ n: 1 });
  } finally {
    s.db.close();
  }
});
it("invalidates reassociation when the target changes and preserves the old association", async () => {
  const s = await setup();
  try {
    const targetId = randomUUID(),
      m = await reassociationCard(s, targetId),
      c = await reassociationController(s);
    const target = (await new ProductMasterRepository(s.a).getProduct(
      targetId,
    ))!.entity;
    await new ProductMasterRepository(s.a).upsertProduct(
      { ...target, label: "Cible modifiée", version: 2 },
      { commandId: randomUUID(), deviceId: s.authority(s.request).deviceId },
    );
    expect((await c.open(m)).status).toBe("STALE");
    await expect(c.confirm(m)).rejects.toThrow("STALE");
    expect(
      JSON.parse(
        (
          s.db
            .prepare("SELECT payload_json FROM commercial_offer_choices")
            .get() as { payload_json: string }
        ).payload_json,
      ).productId,
    ).toBe(s.fixture.product.id);
  } finally {
    s.db.close();
  }
});
it("repairs an association even when the old product profile is no longer on the device", async () => {
  const s = await setup();
  try {
    const targetId = randomUUID(),
      m = await reassociationCard(s, targetId, true),
      c = await reassociationController(s);
    expect((await c.open(m)).status).toBe("READY");
    expect((await c.confirm(m)).status).toBe("COMPLETED");
    expect(
      JSON.parse(
        (
          s.db
            .prepare("SELECT payload_json FROM commercial_offer_choices")
            .get() as { payload_json: string }
        ).payload_json,
      ).productId,
    ).toBe(targetId);
  } finally {
    s.db.close();
  }
});

async function retentionCard(s: Awaited<ReturnType<typeof setup>>) {
  const { copilotMessageSchema } = await import("@fl-copilot/domain"),
    { applyCopilotRecord } = await import("./conversation-repository");
  await s.runtime.execute(s.request, s.authority(s.request));
  const withdrawal = {
    ...s.request,
    operationId: randomUUID(),
    input: {
      expectedVersion: 1,
      productVersion: null,
      draft: { ...s.request.input.draft, status: "WITHDRAWN" },
    },
  };
  const before = (await s.runtime.execute(withdrawal, s.authority(withdrawal)))
    .after;
  s.f.message = {
    ...s.f.message,
    id: randomUUID(),
    text: "Je veux retenir à nouveau cette offre retirée.",
    attachments: [],
  };
  await new CopilotConversationRepository(s.a, s.f).append(s.f.message, {
    commandId: randomUUID(),
    deviceId: s.authority(s.request).deviceId,
  });
  const product = (await new ProductMasterRepository(s.a).getProduct(
    before.productId,
  ))!.entity;
  const assistant = copilotMessageSchema.parse({
    ...s.f.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: s.f.message.id,
    attachments: [],
  });
  const message = copilotMessageSchema.parse({
    ...assistant,
    id: randomUUID(),
    role: "TOOL",
    text: JSON.stringify({
      kind: "COMMERCIAL_CHOICE_RETENTION_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: { choiceId: before.id },
      basis: { before, product },
    }),
  });
  await s.a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, s.f, "copilot_message", assistant);
    await applyCopilotRecord(tx, s.f, "copilot_message", message);
  });
  return message;
}
async function retentionController(
  s: Awaited<ReturnType<typeof setup>>,
  allowed = true,
  db = s.a,
) {
  const { CopilotChoiceRetentionController } =
    await import("./choice-retention-controller");
  return new CopilotChoiceRetentionController(
    db,
    {
      storeId: s.f.storeId,
      ownerId: s.f.ownerId,
      deviceId: s.authority(s.request).deviceId,
      canManageCommercialChoices: allowed,
    },
    testChoiceDigest,
    randomUUID,
  );
}
it("retains a previously withdrawn choice only after a new review, atomically and once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "choice-edit-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const m = await retentionCard(s),
      c = await retentionController(s);
    expect((await c.open(m)).status).toBe("READY");
    const source = JSON.stringify(
      s.db.prepare("SELECT * FROM commercial_visual_readings").get(),
    );
    s.a.fail = true;
    await expect(c.confirm(m)).rejects.toThrow();
    s.a.fail = false;
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_choice_history").get(),
    ).toEqual({ n: 2 });
    await expect(
      (await retentionController(s, false)).confirm(m),
    ).rejects.toThrow("FORBIDDEN");
    await c.confirm(m);
    const row = s.db
      .prepare("SELECT payload_json FROM commercial_offer_choices")
      .get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({
      source: s.fixture.choice.source,
      productId: s.fixture.product.id,
      mechanism: s.fixture.choice.mechanism,
      saleEnd: s.fixture.choice.saleEnd,
      saleStart: s.fixture.choice.saleStart,
      note: s.fixture.choice.note,
      status: "RETAINED",
      version: 3,
    });
    expect(
      JSON.stringify(
        s.db.prepare("SELECT * FROM commercial_visual_readings").get(),
      ),
    ).toBe(source);
    s.db.close();
    reopened = new DatabaseSync(path);
    expect(
      (
        await (
          await retentionController(s, true, new Adapter(reopened))
        ).confirm(m)
      ).status,
    ).toBe("COMPLETED");
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_choice_history")
        .get(),
    ).toEqual({ n: 3 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_OFFER_CHOICE_UPSERT'",
        )
        .get(),
    ).toEqual({ n: 3 });
  } finally {
    reopened?.close();
    try {
      s.db.close();
    } catch {
      /* closed */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rejects re-retention on a changed product, forged card or cancellation", async () => {
  const s = await setup();
  try {
    const m = await retentionCard(s),
      c = await retentionController(s);
    await expect(
      c.confirm({
        ...m,
        text: m.text.replace(s.fixture.product.label, "Autre produit"),
      }),
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(c.confirm(m, abort.signal)).rejects.toThrow();
    await new ProductMasterRepository(s.a).upsertProduct(
      { ...s.fixture.product, label: "Autre libellé", version: 2 },
      { commandId: randomUUID(), deviceId: s.authority(s.request).deviceId },
    );
    expect((await c.open(m)).status).toBe("STALE");
    await expect(c.confirm(m)).rejects.toThrow("STALE");
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_choice_history").get(),
    ).toEqual({ n: 2 });
  } finally {
    s.db.close();
  }
});
