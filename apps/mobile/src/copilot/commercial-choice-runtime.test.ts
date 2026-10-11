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
