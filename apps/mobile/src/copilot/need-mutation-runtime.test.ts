import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  needToolIntent,
  needSaveResultSchema,
  membershipSaveResultSchema,
  substitutionSaveResultSchema,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import { applyNeedUnit } from "../needs/repository";
import { applyProductSubstitution } from "../needs/substitution-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotNeedMutationRuntime } from "./need-mutation-runtime";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  substitutionFixture,
  substitutionDigest,
} from "../../../../scripts/test-substitution-fixtures";
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
    f = await substitutionFixture(),
    chat = chatFixture(randomUUID),
    deviceId = randomUUID();
  chat.storeId = f.need.storeId;
  chat.conversation.storeId = f.need.storeId;
  chat.message.storeId = f.need.storeId;
  await runLocalMigrations(a);
  const conversations = new CopilotConversationRepository(a, chat);
  await conversations.save(chat.conversation, {
    commandId: randomUUID(),
    deviceId,
  });
  await conversations.append(
    {
      ...chat.message,
      text: "Confirme ces associations de besoins.",
      attachments: [],
    },
    { commandId: randomUUID(), deviceId },
  );
  await applyNeedUnit(a, f.need.storeId, f.need);
  for (const p of [f.product, f.substitute])
    await new ProductMasterRepository(a).upsertProduct(p, {
      commandId: randomUUID(),
      deviceId,
    });
  const authority = (r: unknown) => ({
    storeId: f.need.storeId,
    ownerId: chat.ownerId,
    conversationId: chat.conversation.id,
    deviceId,
    canManageProducts: true,
    userMessageId: chat.message.id,
    authorizedRequestJson: needToolIntent(r),
    decisionLevel: "REVIEWED" as const,
  });
  const runtime = new CopilotNeedMutationRuntime(
    a,
    randomUUID,
    substitutionDigest,
    () => "2026-10-11T14:00:00.000Z",
  );
  const association = {
    productId: f.product.id,
    productVersion: 1,
    needUnitId: f.need.id,
    needVersion: 1,
    expectedVersion: null,
    decision: "VALIDATED",
  };
  return { db, a, f, chat, deviceId, authority, runtime, association };
}
it("creates/renames/deactivates a need offline, preserves origin/code and reserved inactive identity and replays after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-need-tools-")),
    path = join(dir, "local.db"),
    x = await setup(path);
  let db = x.db;
  try {
    const create = {
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "need.save",
      input: {
        mode: "CREATE",
        needUnitId: null,
        expectedVersion: null,
        code: "REPAS_RAPIDE",
        name: "Repas rapide",
        description: null,
        status: "ACTIVE",
      },
    };
    const r = needSaveResultSchema.parse(
      await x.runtime.execute(create, x.authority(create)),
    );
    expect(r.after.createdBy).toBe("USER");
    expect(r.after.version).toBe(1);
    db.close();
    db = new DatabaseSync(path);
    const runtime = new CopilotNeedMutationRuntime(
      new Adapter(db),
      randomUUID,
      substitutionDigest,
    );
    expect(await runtime.execute(create, x.authority(create))).toEqual(r);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='need_unit'",
        )
        .get()?.n,
    ).toBe(1);
    const update = {
      ...create,
      operationId: randomUUID(),
      input: {
        ...create.input,
        mode: "UPDATE",
        needUnitId: r.after.id,
        expectedVersion: 1,
        name: "Repas prêt à préparer",
        status: "INACTIVE",
      },
    };
    const next = needSaveResultSchema.parse(
      await runtime.execute(update, x.authority(update)),
    );
    expect(next.after.id).toBe(r.after.id);
    expect(next.after.createdAt).toBe(r.after.createdAt);
    expect(next.after.status).toBe("INACTIVE");
    await expect(
      runtime.execute(
        { ...create, operationId: randomUUID() },
        x.authority({ ...create, operationId: create.operationId }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const duplicate = { ...create, operationId: randomUUID() };
    await expect(
      runtime.execute(duplicate, x.authority(duplicate)),
    ).rejects.toMatchObject({ code: "NEED_CODE_CONFLICT" });
    const recode = {
      ...update,
      operationId: randomUUID(),
      input: { ...update.input, expectedVersion: 2, code: "AUTRE_CODE" },
    };
    await expect(
      runtime.execute(recode, x.authority(recode)),
    ).rejects.toMatchObject({ code: "NEED_CODE_IMMUTABLE" });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("records product/need decisions with deterministic identity and does not silently reactivate a refusal", async () => {
  const x = await setup();
  try {
    const request = {
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "need.membership",
      input: {
        ...x.association,
        strength: 0.8,
        declaredConfidence: 0.6,
        primary: false,
        decision: "REJECTED",
      },
    };
    const r = membershipSaveResultSchema.parse(
      await x.runtime.execute(request, x.authority(request)),
    );
    expect(r.after.status).toBe("REJECTED");
    expect(r.after.humanConfirmed).toBe(true);
    expect(r.after.source).toBe("MANUAL");
    expect(r.after.confidence).toBe(0.6);
    await expect(
      x.runtime.execute(
        { ...request, input: { ...request.input, declaredConfidence: null } },
        x.authority(request),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await x.runtime.execute(request, x.authority(request))).toEqual(r);
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM need_membership_history").get()
        ?.n,
    ).toBe(1);
    const validate = {
      ...request,
      operationId: randomUUID(),
      input: { ...request.input, expectedVersion: 1, decision: "VALIDATED" },
    };
    await expect(
      x.runtime.execute(validate, x.authority(validate)),
    ).rejects.toMatchObject({ code: "RELATION_REFUSAL_REQUIRED" });
    const explicit = {
      ...validate,
      input: { ...validate.input, allowReactivateRejected: true },
    };
    const next = membershipSaveResultSchema.parse(
      await x.runtime.execute(explicit, x.authority(explicit)),
    );
    expect(next.after.id).toBe(r.after.id);
    expect(next.after.status).toBe("VALIDATED");
    expect(next.after.version).toBe(2);
  } finally {
    x.db.close();
  }
});
it("writes only a directed declared relation, preserves learned fields/audit and refuses model-generated learning values", async () => {
  const x = await setup();
  try {
    const learned = {
      ...x.f.substitution,
      status: "LEARNING" as const,
      version: 3,
      evidenceCount: 2,
      observedSubstitution: 0.4,
      relationshipScore: 0.65,
      confidence: 0.75,
      lastEvidenceAt: x.f.need.updatedAt,
    };
    await applyProductSubstitution(x.a, x.f.need.storeId, learned);
    const request = {
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "substitution.save",
      input: {
        ...x.association,
        expectedVersion: 3,
        substituteProductId: x.f.substitute.id,
        substituteProductVersion: 1,
        needCompatibility: 0.9,
        usageCompatibility: 0.7,
        priceCompatibility: null,
        packagingCompatibility: null,
      },
    };
    const r = substitutionSaveResultSchema.parse(
      await x.runtime.execute(request, x.authority(request)),
    );
    expect(r.after).toMatchObject({
      id: learned.id,
      status: "LEARNING",
      evidenceCount: 2,
      observedSubstitution: 0.4,
      relationshipScore: 0.65,
      confidence: 0.75,
      lastEvidenceAt: learned.lastEvidenceAt,
    });
    expect(
      x.db
        .prepare(
          "SELECT COUNT(*) AS n FROM product_substitutions WHERE source_product_id=?",
        )
        .get(x.f.substitute.id)?.n,
    ).toBe(0);
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM substitution_score_history").get()
        ?.n,
    ).toBe(0);
    await expect(
      x.runtime.execute(
        { ...request, input: { ...request.input, relationshipScore: 1 } },
        x.authority(request),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const reject = {
      ...request,
      operationId: randomUUID(),
      input: { ...request.input, expectedVersion: 4, decision: "REJECTED" },
    };
    await x.runtime.execute(reject, x.authority(reject));
    const revive = {
      ...request,
      operationId: randomUUID(),
      input: { ...request.input, expectedVersion: 5 },
    };
    await expect(
      x.runtime.execute(revive, x.authority(revive)),
    ).rejects.toMatchObject({ code: "RELATION_REFUSAL_REQUIRED" });
  } finally {
    x.db.close();
  }
});
it("checks parent revisions, store boundaries, reviewed USER authority and sync conflicts before any mutation", async () => {
  const x = await setup();
  try {
    const request = {
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "need.membership",
      input: {
        ...x.association,
        strength: 0.8,
        declaredConfidence: 0.6,
        primary: true,
      },
    };
    for (const ctx of [
      { ...x.authority(request), canManageProducts: false },
      { ...x.authority(request), ownerId: randomUUID() },
    ])
      await expect(x.runtime.execute(request, ctx)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    await expect(
      x.runtime.execute(request, {
        ...x.authority(request),
        decisionLevel: "ROUTINE",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    const stale = {
      ...request,
      input: { ...request.input, productVersion: 7 },
    };
    await expect(
      x.runtime.execute(stale, x.authority(stale)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const foreign = { ...x.f.product, id: randomUUID(), storeId: randomUUID() };
    await new ProductMasterRepository(x.a).upsertProduct(foreign, {
      commandId: randomUUID(),
      deviceId: x.authority(request).deviceId,
    });
    const other = {
      ...request,
      input: { ...request.input, productId: foreign.id },
    };
    await expect(
      x.runtime.execute(other, x.authority(other)),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    x.db
      .prepare("UPDATE products SET sync_state='CONFLICT' WHERE id=?")
      .run(x.f.product.id);
    await expect(
      x.runtime.execute(request, x.authority(request)),
    ).rejects.toMatchObject({ code: "SYNC_CONFLICT" });
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM need_memberships").get()?.n,
    ).toBe(0);
  } finally {
    x.db.close();
  }
});
it("rolls back canonical entity/history/Outbox/result on commit failure or cancellation and adds one command on retry", async () => {
  const x = await setup();
  try {
    const request = {
        operationId: randomUUID(),
        schemaVersion: 1,
        tool: "need.membership",
        input: {
          ...x.association,
          strength: 0.8,
          declaredConfidence: 0.6,
          primary: true,
        },
      },
      before = x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get();
    x.a.fail = true;
    await expect(
      x.runtime.execute(request, x.authority(request)),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    x.a.fail = false;
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM need_memberships").get()?.n,
    ).toBe(0);
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM need_membership_history").get()
        ?.n,
    ).toBe(0);
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual(
      before,
    );
    const c = new AbortController(),
      runtime = new CopilotNeedMutationRuntime(
        x.a,
        () => {
          c.abort();
          return randomUUID();
        },
        substitutionDigest,
      );
    await expect(
      runtime.execute(request, x.authority(request), c.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM copilot_tool_results").get()?.n,
    ).toBe(0);
    const r = await x.runtime.execute(request, x.authority(request));
    expect(await x.runtime.execute(request, x.authority(request))).toEqual(r);
    expect(
      x.db
        .prepare(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='need_membership'",
        )
        .get()?.n,
    ).toBe(1);
  } finally {
    x.db.close();
  }
});
it("pages the owned need catalogue including inactive/reserved units and current revisions without business writes", async () => {
  const x = await setup();
  try {
    await applyNeedUnit(x.a, x.f.need.storeId, {
      ...x.f.need,
      id: randomUUID(),
      code: "INACTIF",
      status: "INACTIVE",
    });
    const foreignStore = randomUUID();
    await applyNeedUnit(x.a, foreignStore, {
      ...x.f.need,
      id: randomUUID(),
      storeId: foreignStore,
      code: "ETRANGER",
    });
    const { CopilotToolRuntime } = await import("./tool-runtime"),
      { needListResultSchema } = await import("@fl-copilot/domain");
    const runtime = new CopilotToolRuntime(x.a),
      scope = {
        storeId: x.f.need.storeId,
        ownerId: x.chat.ownerId,
        conversationId: x.chat.conversation.id,
        canReadStore: true,
      },
      before = x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get();
    const request = {
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "need.list",
      input: { limit: 1 },
    };
    const first = needListResultSchema.parse(
      await runtime.execute(request, scope),
    );
    expect(first.hasMore).toBe(true);
    const second = needListResultSchema.parse(
      await runtime.execute(
        {
          ...request,
          operationId: randomUUID(),
          input: { limit: 1, afterId: first.nextAfterId },
        },
        scope,
      ),
    );
    expect(second.hasMore).toBe(false);
    const units = [...first.needs, ...second.needs];
    expect(units.some((n) => n.entity.status === "INACTIVE")).toBe(true);
    expect(units.every((n) => n.entity.storeId === scope.storeId)).toBe(true);
    expect(
      units.some((n) => n.entity.id === x.f.need.id && n.entity.version === 1),
    ).toBe(true);
    expect(await runtime.execute(request, scope)).toEqual(first);
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual(
      before,
    );
  } finally {
    x.db.close();
  }
});
it("preserves learned membership confidence and rejects a declared overwrite of empirical confidence", async () => {
  const x = await setup();
  try {
    const { needMembershipId } = await import("@fl-copilot/domain"),
      { applyNeedMembership } = await import("../needs/membership-repository");
    const id = await needMembershipId(
      x.f.need.storeId,
      x.f.product.id,
      x.f.need.id,
      substitutionDigest,
    );
    await applyNeedMembership(x.a, x.f.need.storeId, {
      id,
      storeId: x.f.need.storeId,
      productId: x.f.product.id,
      needUnitId: x.f.need.id,
      strength: 0.8,
      primary: false,
      source: "LEARNED",
      confidence: 0.65,
      status: "VALIDATED",
      humanConfirmed: true,
      version: 3,
      createdAt: x.f.need.createdAt,
      updatedAt: x.f.need.updatedAt,
    });
    const request = {
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "need.membership",
      input: {
        ...x.association,
        expectedVersion: 3,
        strength: 0.8,
        primary: false,
        declaredConfidence: 0.9,
      },
    };
    await expect(
      x.runtime.execute(request, x.authority(request)),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const preserve = {
      ...request,
      input: { ...request.input, declaredConfidence: null },
    };
    const r = membershipSaveResultSchema.parse(
      await x.runtime.execute(preserve, x.authority(preserve)),
    );
    expect(r.after.source).toBe("LEARNED");
    expect(r.after.confidence).toBe(0.65);
  } finally {
    x.db.close();
  }
});

async function savedNeedCard(
  x: Awaited<ReturnType<typeof setup>>,
  input: unknown,
  basis: unknown,
) {
  const b = basis as Record<string, unknown>;
  basis = {
    ...b,
    ...Object.fromEntries(
      ["product", "substitute"].map((k) => [
        k,
        b[k]
          ? {
              packaging: null,
              familyId: null,
              subfamilyId: null,
              ...(b[k] as object),
            }
          : null,
      ]),
    ),
  };
  const { copilotMessageSchema } = await import("@fl-copilot/domain"),
    { applyCopilotRecord } = await import("./conversation-repository");
  const assistant = copilotMessageSchema.parse({
    ...x.chat.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: x.chat.message.id,
    text: "Proposition préparée.",
    attachments: [],
  });
  const message = copilotMessageSchema.parse({
    ...assistant,
    id: randomUUID(),
    role: "TOOL",
    text: JSON.stringify({
      kind: "NEED_MUTATION_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input,
      basis,
    }),
  });
  await x.a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, x.chat, "copilot_message", assistant);
    await applyCopilotRecord(tx, x.chat, "copilot_message", message);
  });
  return message;
}
async function needController(
  x: Awaited<ReturnType<typeof setup>>,
  allowed = true,
  db = x.a,
) {
  const { CopilotNeedProposalController } =
    await import("./need-proposal-controller");
  return new CopilotNeedProposalController(
    db,
    {
      storeId: x.f.need.storeId,
      ownerId: x.chat.ownerId,
      deviceId: x.deviceId,
      canManageProducts: allowed,
    },
    substitutionDigest,
    randomUUID,
  );
}
const emptyBasis = {
  need: null,
  product: null,
  substitute: null,
  membership: null,
  substitution: null,
};
it("confirms need creation, rename and deactivation cards while preserving code and history", async () => {
  const x = await setup();
  try {
    const c = await needController(x),
      m = await savedNeedCard(
        x,
        {
          kind: "NEED",
          action: "PREPARE",
          needUnitId: null,
          patch: { name: "Repas rapide" },
        },
        emptyBasis,
      );
    expect((await c.open(m)).status).toBe("READY");
    await c.confirm(m);
    const r = needSaveResultSchema.parse(
      JSON.parse(
        (
          x.db
            .prepare(
              "SELECT result_json FROM copilot_tool_results WHERE operation_id=?",
            )
            .get(m.id) as { result_json: string }
        ).result_json,
      ),
    );
    expect(r.after.code).toBe("REPAS_RAPIDE");
    const rename = await savedNeedCard(
      x,
      {
        kind: "NEED",
        action: "PREPARE",
        needUnitId: r.after.id,
        patch: { name: "Repas express", status: "INACTIVE" },
      },
      { ...emptyBasis, need: r.after },
    );
    await c.confirm(rename);
    await c.confirm(rename);
    const { NeedUnitRepository } = await import("../needs/repository");
    const after = await new NeedUnitRepository(x.a).get(
      x.f.need.storeId,
      r.after.id,
    );
    expect(after!.entity).toMatchObject({
      code: "REPAS_RAPIDE",
      name: "Repas express",
      status: "INACTIVE",
      version: 2,
    });
    expect(
      x.db.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get(),
    ).toEqual({ n: 2 });
  } finally {
    x.db.close();
  }
});
it("requires a separate explicit reactivation decision and preserves learned substitution values and direction", async () => {
  const x = await setup();
  try {
    const record = {
      ...x.f.substitution,
      status: "REJECTED" as const,
      humanConfirmed: true,
      observedSubstitution: 0.7,
      relationshipScore: 0.6,
      confidence: 0.8,
      evidenceCount: 3,
      lastEvidenceAt: x.f.need.updatedAt,
    };
    await applyProductSubstitution(x.a, x.f.need.storeId, record);
    const c = await needController(x),
      m = await savedNeedCard(
        x,
        {
          kind: "SUBSTITUTION",
          action: "PREPARE",
          needUnitId: x.f.need.id,
          productId: x.f.product.id,
          substituteProductId: x.f.substitute.id,
          patch: { decision: "VALIDATED" },
        },
        {
          ...emptyBasis,
          need: x.f.need,
          product: x.f.product,
          substitute: x.f.substitute,
          substitution: record,
        },
      );
    expect((await c.open(m)).reactivationRequired).toBe(true);
    await expect(c.confirm(m)).rejects.toThrow("REFUSAL_REQUIRED");
    await c.confirm(m, true);
    await c.confirm(m, true);
    const r = substitutionSaveResultSchema.parse(
      JSON.parse(
        (
          x.db
            .prepare(
              "SELECT result_json FROM copilot_tool_results WHERE operation_id=?",
            )
            .get(m.id) as { result_json: string }
        ).result_json,
      ),
    );
    expect(r.after).toMatchObject({
      sourceProductId: x.f.product.id,
      substituteProductId: x.f.substitute.id,
      observedSubstitution: 0.7,
      relationshipScore: 0.6,
      confidence: 0.8,
      evidenceCount: 3,
      status: "VALIDATED",
    });
    expect(
      x.db.prepare("SELECT COUNT(*) n FROM product_substitutions").get(),
    ).toEqual({ n: 1 });
  } finally {
    x.db.close();
  }
});
it("creates membership from a reviewed card, refuses stale parents and revoked/forged artifacts, rolls back cancelled/failed writes", async () => {
  const x = await setup();
  try {
    const c = await needController(x),
      m = await savedNeedCard(
        x,
        {
          kind: "MEMBERSHIP",
          action: "PREPARE",
          needUnitId: x.f.need.id,
          productId: x.f.product.id,
          patch: {
            decision: "VALIDATED",
            strength: 0.8,
            declaredConfidence: 0.7,
          },
        },
        { ...emptyBasis, need: x.f.need, product: x.f.product },
      );
    await expect((await needController(x, false)).confirm(m)).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(
      c.confirm({ ...m, text: m.text.replace("0.8", "0.9") }),
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(c.confirm(m, false, abort.signal)).rejects.toThrow();
    x.a.fail = true;
    await expect(c.confirm(m)).rejects.toThrow();
    x.a.fail = false;
    expect(
      x.db.prepare("SELECT COUNT(*) n FROM need_memberships").get(),
    ).toEqual({ n: 0 });
    expect(
      x.db.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get(),
    ).toEqual({ n: 0 });
    await c.confirm(m);
    const r = membershipSaveResultSchema.parse(
      JSON.parse(
        (
          x.db
            .prepare(
              "SELECT result_json FROM copilot_tool_results WHERE operation_id=?",
            )
            .get(m.id) as { result_json: string }
        ).result_json,
      ),
    );
    const update = await savedNeedCard(
      x,
      {
        kind: "MEMBERSHIP",
        action: "PREPARE",
        needUnitId: x.f.need.id,
        productId: x.f.product.id,
        patch: { decision: "REJECTED" },
      },
      {
        ...emptyBasis,
        need: x.f.need,
        product: x.f.product,
        membership: r.after,
      },
    );
    x.db
      .prepare(
        "UPDATE need_units SET payload_json=json_set(payload_json,'$.version',99)",
      )
      .run();
    expect((await c.open(update)).status).toBe("STALE");
    await expect(c.confirm(update)).rejects.toThrow("STALE");
  } finally {
    x.db.close();
  }
});
it("replays completed need cards after a physical SQLite restart without another command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-need-card-")),
    path = join(dir, "local.db"),
    x = await setup(path);
  let opened: DatabaseSync | undefined;
  try {
    const m = await savedNeedCard(
      x,
      {
        kind: "NEED",
        action: "PREPARE",
        needUnitId: null,
        patch: { name: "Cuisine rapide" },
      },
      emptyBasis,
    );
    await (await needController(x)).confirm(m);
    const count = x.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get();
    x.db.close();
    opened = new DatabaseSync(path);
    expect(
      (await (await needController(x, true, new Adapter(opened))).confirm(m))
        .status,
    ).toBe("COMPLETED");
    expect(opened.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual(
      count,
    );
  } finally {
    if (opened) opened.close();
    else x.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
