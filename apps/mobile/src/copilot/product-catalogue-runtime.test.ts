import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  productCatalogueIntent,
  productSaveResultSchema,
  productRetireResultSchema,
  prepareCatalogueRequest,
  searchCopilotProducts,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  emptyProductDraft,
  productSnapshotToDraft,
  loadProductEditorSnapshot,
} from "../products/product-editor-service";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotProductCatalogueRuntime } from "./product-catalogue-runtime";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
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
      if (this.fail) throw Error("private SQLite detail");
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
  const repo = new CopilotConversationRepository(a, f);
  await repo.save(f.conversation, { commandId: randomUUID(), deviceId });
  await repo.append(
    { ...f.message, text: "Enregistre cette fiche produit.", attachments: [] },
    { commandId: randomUUID(), deviceId },
  );
  const create = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "product.save",
    input: {
      mode: "CREATE",
      productId: null,
      expectedVersion: null,
      expectedChildren: { identifiers: [], aliases: [] },
      draft: {
        ...emptyProductDraft,
        label: "BANANE VRAC",
        nature: "BULK",
        salesUnit: "KG",
        identifiers: [{ type: "PLU", value: "00042" }],
        aliases: [{ alias: "banane" }],
      },
    },
  };
  const authority = (r: unknown) => ({
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    deviceId,
    canManageProducts: true,
    userMessageId: f.message.id,
    authorizedRequestJson: productCatalogueIntent(r),
    decisionLevel: "REVIEWED" as const,
  });
  return {
    db,
    a,
    f,
    create,
    authority,
    runtime: new CopilotProductCatalogueRuntime(
      a,
      randomUUID,
      () => "2026-10-11T13:00:00.000Z",
    ),
  };
}
function edit(
  after: ReturnType<typeof productSaveResultSchema.parse>["after"],
) {
  return {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "product.save",
    input: {
      mode: "UPDATE",
      productId: after.product.entity.id,
      expectedVersion: after.product.entity.version,
      expectedChildren: {
        identifiers: after.identifiers.map((r) => ({
          id: r.entity.id,
          version: r.entity.version,
        })),
        aliases: after.aliases.map((r) => ({
          id: r.entity.id,
          version: r.entity.version,
        })),
      },
      draft: productSnapshotToDraft(after),
    },
  };
}
it("creates a complete aggregate atomically offline with stable IDs/leading-zero identifiers and replays once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-catalogue-tools-")),
    path = join(dir, "local.db"),
    x = await setup(path);
  let db = x.db;
  try {
    const r = productSaveResultSchema.parse(
      await x.runtime.execute(x.create, x.authority(x.create)),
    );
    expect(r.before).toBeNull();
    expect(r.after.identifiers[0]?.entity.value).toBe("00042");
    expect(r.commandIds).toHaveLength(3);
    expect(r.after.product.syncState).toBe("PENDING");
    db.close();
    db = new DatabaseSync(path);
    const runtime = new CopilotProductCatalogueRuntime(
      new Adapter(db),
      randomUUID,
    );
    expect(await runtime.execute(x.create, x.authority(x.create))).toEqual(r);
    expect(db.prepare("SELECT COUNT(*) AS n FROM products").get()?.n).toBe(1);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type LIKE 'product%'",
        )
        .get()?.n,
    ).toBe(3);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("updates packaging/children through the canonical editor, soft-deletes omitted aliases and chains pending versions correctly", async () => {
  const x = await setup();
  try {
    const r = productSaveResultSchema.parse(
        await x.runtime.execute(x.create, x.authority(x.create)),
      ),
      request = edit(r.after);
    request.input.draft.label = "BANANE CONDITIONNÉE";
    request.input.draft.nature = "PACKAGED";
    request.input.draft.salesUnit = "PACK";
    request.input.draft.packagingQuantity = "0,5";
    request.input.draft.packagingUnit = "KG";
    request.input.draft.aliases = [];
    const updated = productSaveResultSchema.parse(
      await x.runtime.execute(request, x.authority(request)),
    );
    expect(updated.after.product.entity.packaging?.quantity).toBe("0.5");
    expect(updated.after.product.entity.version).toBe(2);
    expect(updated.after.identifiers[0]?.entity.value).toBe("00042");
    expect(updated.after.aliases).toHaveLength(0);
    const commands = x.db
      .prepare(
        "SELECT command_type,expected_remote_version FROM sync_outbox WHERE command_id IN (?,?,?)",
      )
      .all(...updated.commandIds);
    expect(commands.every((c) => c.expected_remote_version === 1)).toBe(true);
    expect(
      commands.some((c) => c.command_type === "PRODUCT_ALIAS_DELETE"),
    ).toBe(true);
    expect(
      x.db
        .prepare("SELECT deleted_at FROM product_aliases WHERE id=?")
        .get(r.after.aliases[0]!.entity.id)?.deleted_at,
    ).not.toBeNull();
  } finally {
    x.db.close();
  }
});
it("rejects child revisions/foreign child IDs, identifier collisions and refused aliases before partial writes", async () => {
  const x = await setup();
  try {
    const r = productSaveResultSchema.parse(
        await x.runtime.execute(x.create, x.authority(x.create)),
      ),
      request = edit(r.after),
      alias = r.after.aliases[0]!.entity;
    await new ProductMasterRepository(x.a).upsertAlias(
      { ...alias, status: "REJECTED", version: 2 },
      {
        commandId: randomUUID(),
        deviceId: x.authority(request).deviceId,
        expectedRemoteVersion: 1,
      },
    );
    const count = x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get();
    await expect(
      x.runtime.execute(request, x.authority(request)),
    ).rejects.toMatchObject({ code: "CHILD_CONFLICT" });
    request.input.expectedChildren.aliases[0]!.version = 2;
    request.input.draft.aliases = [{ alias: "banane" }];
    await expect(
      x.runtime.execute(request, x.authority(request)),
    ).rejects.toMatchObject({ code: "ALIAS_REFUSED" });
    request.input.draft.aliases = [{ id: randomUUID(), alias: "banane" }];
    await expect(
      x.runtime.execute(request, x.authority(request)),
    ).rejects.toMatchObject({ code: "CHILD_CONFLICT" });
    const duplicate = {
      ...x.create,
      operationId: randomUUID(),
      input: {
        ...x.create.input,
        draft: { ...x.create.input.draft, label: "Autre banane" },
      },
    };
    await expect(
      x.runtime.execute(duplicate, x.authority(duplicate)),
    ).rejects.toMatchObject({ code: "IDENTIFIER_CONFLICT" });
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual(
      count,
    );
    expect(
      (
        await new ProductMasterRepository(x.a).getProduct(
          r.after.product.entity.id,
        )
      )?.entity.version,
    ).toBe(1);
    request.input.draft.aliases = [{ id: alias.id, alias: alias.alias }];
    const preserved = productSaveResultSchema.parse(
      await x.runtime.execute(request, x.authority(request)),
    );
    expect(preserved.after.aliases[0]?.entity.status).toBe("REJECTED");
  } finally {
    x.db.close();
  }
});
it("retires by canonical tombstone without physical deletion and protects foreign/unknown products, scope and reviewed authority", async () => {
  const x = await setup();
  try {
    const r = productSaveResultSchema.parse(
        await x.runtime.execute(x.create, x.authority(x.create)),
      ),
      request = {
        operationId: randomUUID(),
        schemaVersion: 1,
        tool: "product.retire",
        input: { productId: r.after.product.entity.id, expectedVersion: 1 },
      };
    await expect(
      x.runtime.execute(request, {
        ...x.authority(request),
        decisionLevel: "ROUTINE",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    await expect(
      x.runtime.execute(request, {
        ...x.authority(request),
        ownerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const retired = productRetireResultSchema.parse(
      await x.runtime.execute(request, x.authority(request)),
    );
    expect(retired.after.deletedAt).not.toBeNull();
    expect(retired.after.id).toBe(retired.before.id);
    expect(retired.after.version).toBe(2);
    expect(retired.commandIds).toHaveLength(1);
    expect(await x.runtime.execute(request, x.authority(request))).toEqual(
      retired,
    );
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM products").get()?.n).toBe(1);
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM product_aliases").get()?.n,
    ).toBe(1);
    const foreignProduct = {
      ...r.after.product.entity,
      id: randomUUID(),
      storeId: randomUUID(),
    };
    await new ProductMasterRepository(x.a).upsertProduct(foreignProduct, {
      commandId: randomUUID(),
      deviceId: x.authority(request).deviceId,
    });
    const foreignRequest = {
      ...request,
      operationId: randomUUID(),
      input: {
        productId: foreignProduct.id,
        expectedVersion: foreignProduct.version,
      },
    };
    await expect(
      x.runtime.execute(foreignRequest, x.authority(foreignRequest)),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    expect(
      (await new ProductMasterRepository(x.a).getProduct(foreignProduct.id))
        ?.entity.deletedAt,
    ).toBeNull();
    const missing = {
      ...request,
      operationId: randomUUID(),
      input: { ...request.input, productId: randomUUID() },
    };
    await expect(
      x.runtime.execute(missing, x.authority(missing)),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    await expect(
      x.runtime.execute(request, {
        ...x.authority(request),
        canManageProducts: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      x.runtime.execute(
        { ...x.create, storeId: x.f.storeId },
        x.authority(x.create),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  } finally {
    x.db.close();
  }
});
it("rolls back aggregate, commands and operation result on commit failure or in-flight cancellation", async () => {
  const x = await setup();
  try {
    const before = x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get();
    x.a.fail = true;
    await expect(
      x.runtime.execute(x.create, x.authority(x.create)),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "La correction n’a pas été enregistrée. Vous pouvez réessayer.",
    });
    x.a.fail = false;
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM products").get()?.n).toBe(0);
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM copilot_tool_results").get()?.n,
    ).toBe(0);
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual(
      before,
    );
    const controller = new AbortController(),
      runtime = new CopilotProductCatalogueRuntime(x.a, () => {
        controller.abort();
        return randomUUID();
      });
    await expect(
      runtime.execute(x.create, x.authority(x.create), controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM products").get()?.n).toBe(0);
    await x.runtime.execute(x.create, x.authority(x.create));
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM products").get()?.n).toBe(1);
  } finally {
    x.db.close();
  }
});

async function catalogueCard(
  s: Awaited<ReturnType<typeof setup>>,
  input: unknown,
  before: unknown = null,
) {
  const { copilotMessageSchema } = await import("@fl-copilot/domain");
  const { applyCopilotRecord } = await import("./conversation-repository");
  const assistant = copilotMessageSchema.parse({
    ...s.f.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: s.f.message.id,
    text: "Fiche préparée.",
    attachments: [],
  });
  const message = copilotMessageSchema.parse({
    ...assistant,
    id: randomUUID(),
    role: "TOOL",
    text: JSON.stringify({
      kind: "PRODUCT_CATALOGUE_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input,
      before,
    }),
  });
  await s.a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, s.f, "copilot_message", assistant);
    await applyCopilotRecord(tx, s.f, "copilot_message", message);
  });
  return message;
}
async function catalogueController(
  s: Awaited<ReturnType<typeof setup>>,
  allowed = true,
  a = s.a,
) {
  const { CopilotCatalogueProposalController } =
    await import("./catalogue-proposal-controller");
  return new CopilotCatalogueProposalController(
    a,
    {
      storeId: s.f.storeId,
      ownerId: s.f.ownerId,
      deviceId: s.authority(s.create).deviceId,
      canManageProducts: allowed,
    },
    randomUUID,
  );
}
it("confirms create/update/retirement cards through the canonical writer with exact child lists and preserves unrelated fields", async () => {
  const s = await setup();
  try {
    const c = await catalogueController(s);
    const m = await catalogueCard(s, {
      action: "CREATE",
      productId: null,
      patch: s.create.input.draft,
    });
    expect((await c.open(m)).status).toBe("READY");
    expect(s.db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({
      n: 0,
    });
    expect((await c.confirm(m)).status).toBe("COMPLETED");
    const result = productSaveResultSchema.parse(
      JSON.parse(
        (
          s.db
            .prepare(
              "SELECT result_json FROM copilot_tool_results WHERE operation_id=?",
            )
            .get(m.id) as { result_json: string }
        ).result_json,
      ),
    );
    const productId = result.after.product.entity.id;
    const update = await catalogueCard(
      s,
      {
        action: "UPDATE",
        productId,
        patch: {
          label: "BANANE JAUNE VRAC",
          aliases: [
            ...result.after.aliases.map((r) => ({
              id: r.entity.id,
              alias: r.entity.alias,
            })),
            { alias: "Bananes jaunes" },
          ],
        },
      },
      result.after,
    );
    await c.confirm(update);
    const { loadProductEditorSnapshot } =
      await import("../products/product-editor-service");
    const after = (await loadProductEditorSnapshot(
      new ProductMasterRepository(s.a),
      productId,
    ))!;
    expect(after.product.entity).toMatchObject({
      label: "BANANE JAUNE VRAC",
      nature: "BULK",
      salesUnit: "KG",
    });
    expect(after.identifiers[0]!.entity.value).toBe("00042");
    expect(after.aliases).toHaveLength(2);
    const retire = await catalogueCard(
      s,
      { action: "RETIRE", productId, patch: {} },
      after,
    );
    await c.confirm(retire);
    await c.confirm(retire);
    expect(
      (await new ProductMasterRepository(s.a).getProduct(productId))!.entity
        .deletedAt,
    ).not.toBeNull();
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get(),
    ).toEqual({ n: 3 });
  } finally {
    s.db.close();
  }
});
it("refuses stale child versions, forged artifacts and revoked rights; failed commit rolls back and retry succeeds", async () => {
  const s = await setup();
  try {
    const c = await catalogueController(s),
      m = await catalogueCard(s, {
        action: "CREATE",
        productId: null,
        patch: s.create.input.draft,
      });
    await expect(
      (await catalogueController(s, false)).confirm(m),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      c.confirm({ ...m, text: m.text.replace("BANANE VRAC", "Forgery") }),
    ).rejects.toThrow();
    s.a.fail = true;
    await expect(c.confirm(m)).rejects.toThrow();
    s.a.fail = false;
    expect(s.db.prepare("SELECT COUNT(*) n FROM products").get()).toEqual({
      n: 0,
    });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get(),
    ).toEqual({ n: 0 });
    await c.confirm(m);
    const r = productSaveResultSchema.parse(
      JSON.parse(
        (
          s.db
            .prepare(
              "SELECT result_json FROM copilot_tool_results WHERE operation_id=?",
            )
            .get(m.id) as { result_json: string }
        ).result_json,
      ),
    );
    const update = await catalogueCard(
      s,
      {
        action: "UPDATE",
        productId: r.after.product.entity.id,
        patch: { label: "Autre libellé" },
      },
      r.after,
    );
    s.db.prepare("UPDATE product_aliases SET version=99").run();
    expect((await c.open(update)).status).toBe("STALE");
    await expect(c.confirm(update)).rejects.toThrow("STALE");
  } finally {
    s.db.close();
  }
});
it("restores completed catalogue card replay after a physical SQLite reopen without duplicate commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-catalogue-card-")),
    path = join(dir, "state.db"),
    s = await setup(path);
  let opened: DatabaseSync | undefined;
  try {
    const m = await catalogueCard(s, {
      action: "CREATE",
      productId: null,
      patch: s.create.input.draft,
    });
    await (await catalogueController(s)).confirm(m);
    const count = s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get();
    s.db.close();
    opened = new DatabaseSync(path);
    const controller = await catalogueController(s, true, new Adapter(opened));
    expect((await controller.confirm(m)).status).toBe("COMPLETED");
    expect(opened.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual(
      count,
    );
  } finally {
    if (opened) opened.close();
    else s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("corrects an inactive fiche through the reviewed canonical editor offline without reactivating it, then replays after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-inactive-maintenance-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let db = s.db;
  try {
    const created = productSaveResultSchema.parse(
      await s.runtime.execute(s.create, s.authority(s.create)),
    );
    const repo = new ProductMasterRepository(s.a);
    const productId = created.after.product.entity.id;
    await repo.upsertProduct(
      { ...created.after.product.entity, status: "INACTIVE", version: 2 },
      { commandId: randomUUID(), deviceId: s.authority(s.create).deviceId },
    );
    const before = (await loadProductEditorSnapshot(repo, productId))!;
    const card = await catalogueCard(
      s,
      {
        action: "UPDATE",
        productId,
        patch: { category: "FRUIT", nature: "BULK", salesUnit: "PIECE" },
      },
      before,
    );
    const controller = await catalogueController(s);
    expect((await controller.open(card)).status).toBe("READY");
    expect((await controller.confirm(card)).status).toBe("COMPLETED");
    const after = (await loadProductEditorSnapshot(repo, productId))!;
    expect(after.product.entity).toMatchObject({
      id: productId,
      status: "INACTIVE",
      category: "FRUIT",
      nature: "BULK",
      salesUnit: "PIECE",
      version: 3,
      deletedAt: null,
    });
    expect(after.identifiers).toEqual(before.identifiers);
    expect(after.aliases).toEqual(before.aliases);
    expect(
      searchCopilotProducts(
        s.f.storeId,
        { label: "BANANE VRAC", identifiers: [] },
        {
          products: [after.product.entity],
          identifiers: after.identifiers.map((r) => r.entity),
          aliases: after.aliases.map((r) => r.entity),
        },
      ).candidates,
    ).toHaveLength(0);
    const commands = db.prepare("SELECT COUNT(*) n FROM sync_outbox").get();
    db.close();
    db = new DatabaseSync(path);
    const reopened = { ...s, db, a: new Adapter(db) };
    expect(
      (await (await catalogueController(reopened)).confirm(card)).status,
    ).toBe("COMPLETED");
    expect(db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual(
      commands,
    );
    expect(
      (
        await loadProductEditorSnapshot(
          new ProductMasterRepository(reopened.a),
          productId,
        )
      )?.product.entity.status,
    ).toBe("INACTIVE");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps inactive retirement, deleted targets and stale reviews protected without writing commands", async () => {
  const s = await setup();
  try {
    const created = productSaveResultSchema.parse(
      await s.runtime.execute(s.create, s.authority(s.create)),
    );
    const repo = new ProductMasterRepository(s.a),
      productId = created.after.product.entity.id;
    await repo.upsertProduct(
      { ...created.after.product.entity, status: "INACTIVE", version: 2 },
      {
        commandId: randomUUID(),
        deviceId: s.authority(s.create).deviceId,
      },
    );
    const before = (await loadProductEditorSnapshot(repo, productId))!;
    const retire = {
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "product.retire",
      input: { productId, expectedVersion: 2 },
    };
    const commands = s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get();
    expect(() =>
      prepareCatalogueRequest(
        { action: "RETIRE", productId, patch: {} },
        before,
        randomUUID(),
      ),
    ).toThrow("TARGET_UNAVAILABLE");
    await expect(
      s.runtime.execute(retire, s.authority(retire)),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    expect(s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual(
      commands,
    );
    const card = await catalogueCard(
      s,
      { action: "UPDATE", productId, patch: { category: "FRUIT" } },
      before,
    );
    await repo.upsertProduct(
      { ...before.product.entity, label: "BANANE MODIFIÉE", version: 3 },
      {
        commandId: randomUUID(),
        deviceId: s.authority(s.create).deviceId,
      },
    );
    const afterConcurrent = s.db
      .prepare("SELECT COUNT(*) n FROM sync_outbox")
      .get();
    await expect((await catalogueController(s)).confirm(card)).rejects.toThrow(
      "STALE",
    );
    expect(s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual(
      afterConcurrent,
    );
    const current = (await loadProductEditorSnapshot(repo, productId))!;
    expect(() =>
      prepareCatalogueRequest(
        { action: "UPDATE", productId, patch: { label: "Renommée" } },
        {
          ...current,
          product: {
            ...current.product,
            entity: {
              ...current.product.entity,
              deletedAt: "2026-10-23T12:00:00.000Z",
            },
          },
        },
        randomUUID(),
      ),
    ).toThrow("TARGET_UNAVAILABLE");
    await repo.delete(
      "product",
      productId,
      s.f.storeId,
      "2026-10-23T12:00:00.000Z",
      { commandId: randomUUID(), deviceId: s.authority(s.create).deviceId },
    );
    const update = edit(current),
      afterDeletion = s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get();
    await expect(
      s.runtime.execute(update, s.authority(update)),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    expect(s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual(
      afterDeletion,
    );
  } finally {
    s.db.close();
  }
});
