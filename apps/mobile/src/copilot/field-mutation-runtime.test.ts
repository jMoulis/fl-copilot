import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  fieldToolIntent,
  captureFieldEventResultSchema,
  closeFieldEventResultSchema,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import { applyStoreProductEvent } from "../needs/store-event-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotFieldMutationRuntime } from "./field-mutation-runtime";
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
  const conversation = new CopilotConversationRepository(a, f);
  await conversation.save(f.conversation, {
    commandId: randomUUID(),
    deviceId,
  });
  await conversation.append(
    {
      ...f.message,
      text: "Signale la rupture de ce produit.",
      attachments: [],
    },
    { commandId: randomUUID(), deviceId },
  );
  const product = {
    id: randomUUID(),
    storeId: f.storeId,
    label: "BANANE VRAC",
    category: "UNKNOWN" as const,
    nature: "UNKNOWN" as const,
    salesUnit: "UNKNOWN" as const,
    status: "ACTIVE" as const,
    version: 1,
    createdAt: f.conversation.createdAt,
    updatedAt: f.conversation.createdAt,
    deletedAt: null,
  };
  await new ProductMasterRepository(a).upsertProduct(product, {
    commandId: randomUUID(),
    deviceId,
  });
  const capture = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "store.event.capture",
    input: {
      productId: product.id,
      productVersion: 1,
      type: "OUT_OF_STOCK",
      startedAt: "2026-10-11T13:00:00+02:00",
      endedAt: null,
      severity: "MEDIUM",
      comment: "Rayon vide constaté",
    },
  };
  const authority = (r: unknown) => ({
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    deviceId,
    canCaptureStoreEvents: true,
    userMessageId: f.message.id,
    authorizedRequestJson: fieldToolIntent(r),
    decisionLevel: "REVIEWED" as const,
  });
  return {
    db,
    a,
    f,
    product,
    capture,
    authority,
    runtime: new CopilotFieldMutationRuntime(
      a,
      randomUUID,
      () => "2026-10-11T15:00:00.000Z",
    ),
  };
}
it("captures a scoped USER observation offline with normalized dates/stable identity and replays once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-field-tools-")),
    path = join(dir, "db.sqlite"),
    x = await setup(path);
  let db = x.db;
  try {
    const r = captureFieldEventResultSchema.parse(
      await x.runtime.execute(x.capture, x.authority(x.capture)),
    );
    expect(r.after).toMatchObject({
      source: "USER",
      sourceDocumentId: null,
      status: "ACTIVE",
      startedAt: "2026-10-11T11:00:00.000Z",
      clientCapturedAt: "2026-10-11T15:00:00.000Z",
    });
    expect(r.after).not.toHaveProperty("stockQuantity");
    db.close();
    db = new DatabaseSync(path);
    const runtime = new CopilotFieldMutationRuntime(
      new Adapter(db),
      randomUUID,
    );
    expect(await runtime.execute(x.capture, x.authority(x.capture))).toEqual(r);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM store_product_events").get()?.n,
    ).toBe(1);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM store_product_event_history").get()
        ?.n,
    ).toBe(1);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE command_type='CREATE_STORE_EVENT'",
        )
        .get()?.n,
    ).toBe(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("closes using canonical history/Outbox, chains pending versions and treats the same closed date as a no-op", async () => {
  const x = await setup();
  try {
    const create = captureFieldEventResultSchema.parse(
        await x.runtime.execute(x.capture, x.authority(x.capture)),
      ),
      request = {
        operationId: randomUUID(),
        schemaVersion: 1,
        tool: "store.event.close",
        input: {
          eventId: create.after.id,
          expectedVersion: 1,
          endedAt: "2026-10-11T14:00:00.000Z",
        },
      };
    const r = closeFieldEventResultSchema.parse(
      await x.runtime.execute(request, x.authority(request)),
    );
    expect(r.after.status).toBe("CLOSED");
    expect(r.after.version).toBe(2);
    expect(r.after.clientCapturedAt).toBe(create.after.clientCapturedAt);
    expect(r.after.startedAt).toBe(create.after.startedAt);
    expect(
      x.db
        .prepare(
          "SELECT expected_remote_version FROM sync_outbox WHERE command_id=?",
        )
        .get(r.commandId!)?.expected_remote_version,
    ).toBe(1);
    expect(await x.runtime.execute(request, x.authority(request))).toEqual(r);
    const noop = {
      ...request,
      operationId: randomUUID(),
      input: { ...request.input, expectedVersion: 2 },
    };
    expect(
      closeFieldEventResultSchema.parse(
        await x.runtime.execute(noop, x.authority(noop)),
      ).commandId,
    ).toBeNull();
    expect(
      x.db
        .prepare("SELECT COUNT(*) AS n FROM store_product_event_history")
        .get()?.n,
    ).toBe(2);
    const different = {
      ...noop,
      operationId: randomUUID(),
      input: { ...noop.input, endedAt: "2026-10-11T14:30:00.000Z" },
    };
    await expect(
      x.runtime.execute(different, x.authority(different)),
    ).rejects.toMatchObject({ code: "EVENT_ALREADY_CLOSED" });
  } finally {
    x.db.close();
  }
});
it("rejects future/invalid dates, stale versions, private scope, revoked field permission and forged source/stock authority", async () => {
  const x = await setup();
  try {
    await expect(
      x.runtime.execute(x.capture, {
        ...x.authority(x.capture),
        canCaptureStoreEvents: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      x.runtime.execute(x.capture, {
        ...x.authority(x.capture),
        ownerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      x.runtime.execute(
        { ...x.capture, input: { ...x.capture.input, stockQuantity: 0 } },
        x.authority(x.capture),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      x.runtime.execute(
        { ...x.capture, input: { ...x.capture.input, source: "USER" } },
        x.authority(x.capture),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const future = {
      ...x.capture,
      input: { ...x.capture.input, startedAt: "2026-10-12T15:00:00Z" },
    };
    await expect(
      x.runtime.execute(future, x.authority(future)),
    ).rejects.toMatchObject({ code: "EVENT_DATE_INVALID" });
    const stale = {
      ...x.capture,
      input: { ...x.capture.input, productVersion: 7 },
    };
    await expect(
      x.runtime.execute(stale, x.authority(stale)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const { CopilotProductMutationRuntime } =
        await import("./product-mutation-runtime"),
      { productClassificationIntent } = await import("@fl-copilot/domain");
    const classify = {
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "product.classify",
      input: {
        changes: [
          {
            productId: x.product.id,
            expectedVersion: 1,
            patch: { category: "FRUIT" },
          },
        ],
      },
    };
    const { canCaptureStoreEvents: fieldPermission, ...scope } = x.authority(
      x.capture,
    );
    expect(fieldPermission).toBe(true);
    await expect(
      new CopilotProductMutationRuntime(x.a, randomUUID).execute(classify, {
        ...scope,
        canManageProducts: false,
        authorizedRequestJson: productClassificationIntent(classify),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const created = captureFieldEventResultSchema.parse(
        await x.runtime.execute(x.capture, x.authority(x.capture)),
      ),
      close = {
        operationId: randomUUID(),
        schemaVersion: 1,
        tool: "store.event.close",
        input: {
          eventId: created.after.id,
          expectedVersion: 1,
          endedAt: "2026-10-11T10:00:00.000Z",
        },
      };
    await expect(
      x.runtime.execute(close, x.authority(close)),
    ).rejects.toMatchObject({ code: "EVENT_DATE_INVALID" });
    await expect(
      x.runtime.execute(x.capture, {
        ...x.authority(x.capture),
        canCaptureStoreEvents: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreign = { ...x.product, id: randomUUID(), storeId: randomUUID() };
    await new ProductMasterRepository(x.a).upsertProduct(foreign, {
      commandId: randomUUID(),
      deviceId: x.authority(x.capture).deviceId,
    });
    const other = {
      ...x.capture,
      operationId: randomUUID(),
      input: { ...x.capture.input, productId: foreign.id },
    };
    await expect(
      x.runtime.execute(other, x.authority(other)),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
  } finally {
    x.db.close();
  }
});
it("does not close a commercial extraction or unresolved event and rolls back capture/history/command/result on failure and cancellation", async () => {
  const x = await setup();
  try {
    const before = x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get();
    x.a.fail = true;
    await expect(
      x.runtime.execute(x.capture, x.authority(x.capture)),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    x.a.fail = false;
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM store_product_events").get()?.n,
    ).toBe(0);
    expect(
      x.db
        .prepare("SELECT COUNT(*) AS n FROM store_product_event_history")
        .get()?.n,
    ).toBe(0);
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual(
      before,
    );
    const controller = new AbortController(),
      runtime = new CopilotFieldMutationRuntime(x.a, () => {
        controller.abort();
        return randomUUID();
      });
    await expect(
      runtime.execute(x.capture, x.authority(x.capture), controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM copilot_tool_results").get()?.n,
    ).toBe(0);
    const created = captureFieldEventResultSchema.parse(
        await x.runtime.execute(x.capture, x.authority(x.capture)),
      ),
      document = {
        ...created.after,
        id: randomUUID(),
        source: "COMMERCIAL_PDF" as const,
        sourceDocumentId: randomUUID(),
        status: "TO_REVIEW" as const,
      };
    await applyStoreProductEvent(x.a, x.f.storeId, document);
    const close = {
      operationId: randomUUID(),
      schemaVersion: 1,
      tool: "store.event.close",
      input: {
        eventId: document.id,
        expectedVersion: 1,
        endedAt: "2026-10-11T14:00:00Z",
      },
    };
    await expect(
      x.runtime.execute(close, x.authority(close)),
    ).rejects.toMatchObject({ code: "EVENT_SOURCE_READ_ONLY" });
    x.db
      .prepare(
        "UPDATE store_product_events SET sync_state='CONFLICT' WHERE id=?",
      )
      .run(created.after.id);
    const conflict = {
      ...close,
      operationId: randomUUID(),
      input: { ...close.input, eventId: created.after.id },
    };
    await expect(
      x.runtime.execute(conflict, x.authority(conflict)),
    ).rejects.toMatchObject({ code: "SYNC_CONFLICT" });
  } finally {
    x.db.close();
  }
});
