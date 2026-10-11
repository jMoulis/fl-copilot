import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { offerValidationIntent } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotOfferValidationRuntime } from "./offer-validation-runtime";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  commercialChoiceFixture,
  testChoiceDigest,
} from "../../../../scripts/test-commercial-choice-fixtures";
import { applyCommercialVisualReading } from "../commercial/visual-repository";
import { applyCommercialChoice } from "../commercial/offer-choice-repository";
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
      text: "Je valide ces offres après revue du document.",
      attachments: [],
    },
    { commandId: randomUUID(), deviceId },
  );
  const fixtures = await Promise.all([
    commercialChoiceFixture({ storeId: f.storeId }),
    commercialChoiceFixture({ storeId: f.storeId }),
  ]);
  for (const item of fixtures) {
    await new ProductMasterRepository(a).upsertProduct(item.product, {
      commandId: randomUUID(),
      deviceId,
    });
    await applyCommercialVisualReading(a, f.storeId, item.reading);
    await applyCommercialChoice(a, f.storeId, item.choice);
  }
  const request = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "commercial.offer.validate",
    input: {
      selection: fixtures.map((r) => ({
        choiceId: r.choice.id,
        choiceVersion: 1,
        productVersion: 1,
      })),
    },
  };
  const authority = (r: unknown) => ({
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    deviceId,
    canValidateCommercialOffers: true,
    userMessageId: f.message.id,
    authorizedRequestJson: offerValidationIntent(r),
    decisionLevel: "REVIEWED" as const,
    reviewedSources: fixtures.map((r) => ({
      choiceId: r.choice.id,
      choiceVersion: 1,
      readingId: r.reading.id,
      checksum: r.reading.checksum,
    })),
  });
  const runtime = new CopilotOfferValidationRuntime(
    a,
    testChoiceDigest,
    randomUUID,
    () => "2026-10-11T12:00:00Z",
  );
  return { db, a, f, fixtures, request, authority, runtime };
}
it("validates a reviewed batch offline, replays after restart and preserves immutable existing validations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-validation-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const result = await s.runtime.execute(s.request, s.authority(s.request));
    expect(result.validations).toHaveLength(2);
    expect(
      result.validations.every((v) => v.commandId && v.syncState === "PENDING"),
    ).toBe(true);
    s.db.close();
    reopened = new DatabaseSync(path);
    const r = new CopilotOfferValidationRuntime(
      new Adapter(reopened),
      testChoiceDigest,
      randomUUID,
    );
    expect(await r.execute(s.request, s.authority(s.request))).toEqual(result);
    const repeat = { ...s.request, operationId: randomUUID() },
      again = await r.execute(repeat, s.authority(repeat));
    expect(again.validations.map((v) => v.commandId)).toEqual([null, null]);
    expect(again.validations.map((v) => v.entity)).toEqual(
      result.validations.map((v) => v.entity),
    );
    expect(
      reopened
        .prepare("SELECT COUNT(*) n FROM commercial_offer_validation_history")
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_OFFER_VALIDATE'",
        )
        .get(),
    ).toEqual({ n: 2 });
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get(),
    ).toEqual({ n: 0 });
    await expect(
      r.execute(s.request, {
        ...s.authority(s.request),
        canValidateCommercialOffers: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("requires exact source review attestations and current product/choice revisions", async () => {
  const s = await setup();
  try {
    const auth = s.authority(s.request);
    await expect(
      s.runtime.execute(s.request, {
        ...auth,
        reviewedSources: [auth.reviewedSources[0]!, auth.reviewedSources[0]!],
      }),
    ).rejects.toMatchObject({ code: "COMMERCIAL_SOURCE_REVIEW_REQUIRED" });
    await expect(
      s.runtime.execute(s.request, {
        ...auth,
        reviewedSources: auth.reviewedSources.map((v) => ({
          ...v,
          checksum: "changed",
        })),
      }),
    ).rejects.toMatchObject({ code: "COMMERCIAL_SOURCE_REVIEW_REQUIRED" });
    await expect(
      s.runtime.execute(s.request, { ...auth, decisionLevel: "ROUTINE" }),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    const stale = {
      ...s.request,
      input: {
        selection: s.request.input.selection.map((r) => ({
          ...r,
          productVersion: 2,
        })),
      },
    };
    await expect(
      s.runtime.execute(stale, s.authority(stale)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const row = s.db
        .prepare("SELECT payload_json FROM commercial_offer_choices WHERE id=?")
        .get(s.fixtures[1]!.choice.id) as { payload_json: string },
      choice = JSON.parse(row.payload_json);
    choice.version++;
    s.db
      .prepare("UPDATE commercial_offer_choices SET payload_json=? WHERE id=?")
      .run(JSON.stringify(choice), choice.id);
    await expect(s.runtime.execute(s.request, auth)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_validated_offers").get(),
    ).toEqual({ n: 0 });
  } finally {
    s.db.close();
  }
});
it("rolls back the whole batch if the second source is invalid, a commit fails or the operation is cancelled", async () => {
  const s = await setup();
  try {
    const id = s.fixtures[1]!.reading.id;
    s.db.prepare("DELETE FROM commercial_visual_readings WHERE id=?").run(id);
    await expect(
      s.runtime.execute(s.request, s.authority(s.request)),
    ).rejects.toMatchObject({ code: "COMMERCIAL_SOURCE_INVALID" });
    await applyCommercialVisualReading(
      s.a,
      s.f.storeId,
      s.fixtures[1]!.reading,
    );
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
      "commercial_validated_offers",
      "commercial_offer_validation_history",
      "copilot_tool_results",
    ])
      expect(s.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({
        n: 0,
      });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_OFFER_VALIDATE'",
        )
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    s.db.close();
  }
});
it("preserves failed validation records and forbids foreign or mismatched cached source review", async () => {
  const s = await setup();
  try {
    await s.runtime.execute(s.request, s.authority(s.request));
    await expect(
      s.runtime.execute(s.request, {
        ...s.authority(s.request),
        ownerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const auth = s.authority(s.request);
    await expect(
      s.runtime.execute(s.request, {
        ...auth,
        reviewedSources: auth.reviewedSources.map((v) => ({
          ...v,
          checksum: "other",
        })),
      }),
    ).rejects.toMatchObject({ code: "COMMERCIAL_SOURCE_REVIEW_REQUIRED" });
    s.db
      .prepare("UPDATE commercial_validated_offers SET sync_state='ERROR'")
      .run();
    const next = { ...s.request, operationId: randomUUID() };
    await expect(
      s.runtime.execute(next, s.authority(next)),
    ).rejects.toMatchObject({ code: "SYNC_CONFLICT" });
    expect(
      s.db
        .prepare("SELECT COUNT(*) n FROM commercial_offer_validation_history")
        .get(),
    ).toEqual({ n: 2 });
  } finally {
    s.db.close();
  }
});
