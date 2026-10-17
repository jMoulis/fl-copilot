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

async function validationCard(s: Awaited<ReturnType<typeof setup>>) {
  const { copilotMessageSchema } = await import("@fl-copilot/domain");
  const { projectCommercialSourceOffer } =
    await import("@fl-copilot/commercial-core");
  const { applyCopilotRecord } = await import("./conversation-repository");
  const entries = await Promise.all(
    s.fixtures.map(async (f) => {
      const row = await s.a.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM commercial_validated_offers WHERE choice_id=?",
        f.choice.id,
      );
      return {
        choice: f.choice,
        product: (await new ProductMasterRepository(s.a).getProduct(
          f.product.id,
        ))!.entity,
        offer: projectCommercialSourceOffer(f.reading, 0, 0),
        validation: row ? JSON.parse(row.payload_json) : null,
      };
    }),
  );
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
      kind: "OFFER_VALIDATION_PROPOSAL",
      schemaVersion: 1,
      assistantMessageId: assistant.id,
      input: { choiceIds: entries.map((e) => e.choice.id) },
      basis: { storeId: s.f.storeId, entries },
    }),
  });
  await s.a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, s.f, "copilot_message", assistant);
    await applyCopilotRecord(tx, s.f, "copilot_message", message);
  });
  return message;
}
async function validationController(
  s: Awaited<ReturnType<typeof setup>>,
  allowed = true,
) {
  const { CopilotOfferValidationController } =
    await import("./offer-validation-controller");
  return new CopilotOfferValidationController(
    s.a,
    {
      storeId: s.f.storeId,
      ownerId: s.f.ownerId,
      deviceId: s.authority(s.request).deviceId,
      canValidateCommercialOffers: allowed,
    },
    testChoiceDigest,
    randomUUID,
  );
}
it("confirms a private reviewed batch, preserves an existing validation and replays without duplicate writes", async () => {
  const s = await setup();
  try {
    const first = {
      ...s.request,
      input: { selection: [s.request.input.selection[0]] },
    };
    const old = await s.runtime.execute(first, {
      ...s.authority(first),
      reviewedSources: [s.authority(first).reviewedSources[0]!],
    });
    const message = await validationCard(s),
      c = await validationController(s);
    expect((await c.open(message)).status).toBe("READY");
    await expect(c.confirm(message, false)).rejects.toThrow("REVIEW_REQUIRED");
    await expect(
      (await validationController(s, false)).confirm(message, true),
    ).rejects.toThrow("FORBIDDEN");
    s.a.fail = true;
    await expect(c.confirm(message, true)).rejects.toThrow();
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_validated_offers").get(),
    ).toEqual({ n: 1 });
    s.a.fail = false;
    expect((await c.confirm(message, true)).status).toBe("COMPLETED");
    expect(
      (await (await validationController(s)).confirm(message, true)).status,
    ).toBe("COMPLETED");
    const journal = await s.a.getFirstAsync<{ result_json: string }>(
      "SELECT result_json FROM copilot_tool_results WHERE operation_id=?",
      message.id,
    );
    const result = JSON.parse(journal!.result_json);
    expect(result.validations[0].entity).toEqual(old.validations[0]!.entity);
    expect(result.validations[0].commandId).toBeNull();
    expect(
      s.db
        .prepare("SELECT COUNT(*) n FROM commercial_offer_validation_history")
        .get(),
    ).toEqual({ n: 2 });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE command_type='COMMERCIAL_OFFER_VALIDATE'",
        )
        .get(),
    ).toEqual({ n: 2 });
  } finally {
    s.db.close();
  }
});
it.each(["product", "choice", "source", "validation"])(
  "rejects an entire private review when %s changes",
  async (kind) => {
    const s = await setup();
    try {
      const message = await validationCard(s),
        c = await validationController(s);
      expect((await c.open(message)).status).toBe("READY");
      if (kind === "product")
        s.db
          .prepare("UPDATE products SET version=version+1 WHERE id=?")
          .run(s.fixtures[1]!.product.id);
      if (kind === "choice")
        s.db
          .prepare(
            "UPDATE commercial_offer_choices SET sync_state='CONFLICT' WHERE id=?",
          )
          .run(s.fixtures[1]!.choice.id);
      if (kind === "source")
        s.db
          .prepare("DELETE FROM commercial_visual_readings WHERE id=?")
          .run(s.fixtures[1]!.reading.id);
      if (kind === "validation")
        await s.runtime.execute(
          {
            ...s.request,
            input: { selection: [s.request.input.selection[1]] },
          },
          {
            ...s.authority(s.request),
            authorizedRequestJson: offerValidationIntent({
              ...s.request,
              input: { selection: [s.request.input.selection[1]] },
            }),
            reviewedSources: [s.authority(s.request).reviewedSources[1]!],
          },
        );
      expect((await c.open(message)).status).toBe("STALE");
      await expect(c.confirm(message, true)).rejects.toThrow("STALE");
      expect(
        s.db
          .prepare("SELECT COUNT(*) n FROM commercial_validated_offers")
          .get(),
      ).toEqual({ n: kind === "validation" ? 1 : 0 });
    } finally {
      s.db.close();
    }
  },
);

it("refuses validation when retained price units disagree with the active product", async () => {
  const s = await setup();
  try {
    s.db
      .prepare("UPDATE products SET sales_unit='PIECE' WHERE id=?")
      .run(s.fixtures[1]!.product.id);
    await expect(
      s.runtime.execute(s.request, s.authority(s.request)),
    ).rejects.toThrow();
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM commercial_validated_offers").get(),
    ).toEqual({ n: 0 });
    expect(
      s.db
        .prepare("SELECT COUNT(*) n FROM commercial_offer_validation_history")
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    s.db.close();
  }
});
