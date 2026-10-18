import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readIdentityReviewProposal } from "@fl-copilot/domain";
import { identityFixture } from "../../../../scripts/test-identity-review-fixtures";
import { buildIdentityReviewMessages } from "../../../api/src/copilot/identity-review-messages";
import { runLocalMigrations } from "../db/migrations";
import { applyProductMasterSnapshot } from "../products/apply-product-master";
import { ProductMasterRepository } from "../products/product-master-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "./conversation-repository";
import { CopilotIdentityReviewController } from "./identity-review-controller";
import { CopilotIdentityReviewRuntime } from "./identity-review-runtime";
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
      if (this.fail) throw Error("private database detail");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
async function setup(
  kind: "ALIAS" | "IDENTIFIER" = "ALIAS",
  status: "TO_REVIEW" | "REJECTED" = "TO_REVIEW",
  path = ":memory:",
  reject = false,
) {
  const f = identityFixture(kind, status),
    db = new DatabaseSync(path),
    a = new Adapter(db);
  await runLocalMigrations(a);
  await applyProductMasterSnapshot(a, f.chat.storeId, {
    products: [f.product],
    productIdentifiers: kind === "IDENTIFIER" ? [f.entry] : [],
    productAliases: kind === "ALIAS" ? [f.entry] : [],
  });
  if (reject) {
    f.preview.input.decision = "REJECT";
  }
  const repo = new CopilotConversationRepository(a, f.chat);
  await repo.save(f.chat.conversation, {
    deviceId: f.chat.deviceId,
    commandId: randomUUID(),
  });
  await repo.append(f.chat.message, {
    deviceId: f.chat.deviceId,
    commandId: randomUUID(),
  });
  const message = buildIdentityReviewMessages(f.assistant, [f.preview])[0]!;
  await a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(tx, f.chat, "copilot_message", f.assistant);
    await applyCopilotRecord(tx, f.chat, "copilot_message", message);
  });
  const scope = {
    storeId: f.chat.storeId,
    ownerId: f.chat.ownerId,
    deviceId: f.chat.deviceId,
    canManageProducts: true,
  };
  const controller = new CopilotIdentityReviewController(a, scope, randomUUID),
    runtime = new CopilotIdentityReviewRuntime(
      a,
      randomUUID,
      () => "2026-10-11T12:02:00.000Z",
    ),
    request = readIdentityReviewProposal(message).request;
  const authority = {
    ...scope,
    conversationId: f.chat.conversation.id,
    userMessageId: f.chat.message.id,
    authorizedRequestJson: JSON.stringify(request),
    decisionLevel: "REVIEWED" as const,
    reactivateRejectedAlias: false,
  };
  const counts = () => ({
    outbox: (
      db.prepare("SELECT COUNT(*) n FROM sync_outbox").get() as { n: number }
    ).n,
    journal: (
      db.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get() as {
        n: number;
      }
    ).n,
  });
  return {
    f,
    db,
    a,
    scope,
    controller,
    runtime,
    request,
    authority,
    message,
    counts,
  };
}
it.each(["ALIAS", "IDENTIFIER"] as const)(
  "validates only the targeted %s offline, preserves provenance and replays once after restart",
  async (kind) => {
    const dir = mkdtempSync(join(tmpdir(), "fl-identity-")),
      path = join(dir, "local.db"),
      s = await setup(kind, "TO_REVIEW", path);
    let reopened: DatabaseSync | undefined;
    try {
      const initial = s.counts();
      expect((await s.controller.confirm(s.message, false)).status).toBe(
        "COMPLETED",
      );
      const repo = new ProductMasterRepository(s.a),
        record =
          kind === "ALIAS"
            ? await repo.getAlias(s.f.entry.id)
            : await repo.getIdentifier(s.f.entry.id);
      expect(record?.entity).toEqual({
        ...s.f.entry,
        status: "VALIDATED",
        version: 4,
        updatedAt: record!.entity.updatedAt,
      });
      expect((await repo.getProduct(s.f.product.id))?.entity).toEqual(
        s.f.product,
      );
      const row = await s.a.getFirstAsync<{
        payload_json: string;
        expected_remote_version: number;
      }>(
        "SELECT payload_json,expected_remote_version FROM sync_outbox WHERE entity_id=?",
        s.f.entry.id,
      );
      expect(row?.expected_remote_version).toBe(3);
      expect(JSON.parse(row!.payload_json)).toEqual(record?.entity);
      expect(s.counts()).toEqual({ outbox: initial.outbox + 1, journal: 1 });
      s.db.close();
      reopened = new DatabaseSync(path);
      expect(
        (
          await new CopilotIdentityReviewController(
            new Adapter(reopened),
            s.scope,
            randomUUID,
          ).confirm(s.message, false)
        ).status,
      ).toBe("COMPLETED");
      expect(
        (
          reopened
            .prepare("SELECT COUNT(*) n FROM copilot_tool_results")
            .get() as { n: number }
        ).n,
      ).toBe(1);
    } finally {
      if (reopened) reopened.close();
      else s.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
it("preserves a rejected alias unless a separate native reactivation is explicitly granted", async () => {
  const s = await setup("ALIAS", "REJECTED");
  try {
    const initial = s.counts();
    await expect(s.controller.confirm(s.message, false)).rejects.toThrow(
      "réactiver",
    );
    expect(s.counts()).toEqual(initial);
    expect((await s.controller.confirm(s.message, true)).status).toBe(
      "COMPLETED",
    );
    expect(
      (await new ProductMasterRepository(s.a).getAlias(s.f.entry.id))?.entity
        .source,
    ).toBe("AI_PROPOSED");
  } finally {
    s.db.close();
  }
});
it("records an explicit alias refusal without rewriting the product or historical observations", async () => {
  const s = await setup("ALIAS", "TO_REVIEW", ":memory:", true);
  try {
    await s.controller.confirm(s.message, false);
    expect(
      (await new ProductMasterRepository(s.a).getAlias(s.f.entry.id))?.entity
        .status,
    ).toBe("REJECTED");
    expect(
      (await new ProductMasterRepository(s.a).getProduct(s.f.product.id))
        ?.entity,
    ).toEqual(s.f.product);
    expect(
      (
        await s.a.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) n FROM sales_observations",
        )
      )?.n,
    ).toBe(0);
  } finally {
    s.db.close();
  }
});
it.each([
  "PRODUCT_VERSION",
  "ENTRY_VERSION",
  "CONFLICT",
  "ALIAS_COLLISION",
  "LABEL_COLLISION",
  "IDENTIFIER_COLLISION",
  "LIMIT",
])(
  "rechecks local changes and ambiguity before committing (%s)",
  async (mode) => {
    const s = await setup(
      mode === "IDENTIFIER_COLLISION" ? "IDENTIFIER" : "ALIAS",
    );
    try {
      const repo = new ProductMasterRepository(s.a);
      if (mode === "PRODUCT_VERSION")
        await s.a.runAsync(
          "UPDATE products SET version=version+1 WHERE id=?",
          s.f.product.id,
        );
      if (mode === "ENTRY_VERSION")
        await s.a.runAsync(
          "UPDATE product_aliases SET version=version+1 WHERE id=?",
          s.f.entry.id,
        );
      if (mode === "CONFLICT")
        await s.a.runAsync(
          "UPDATE product_aliases SET sync_state='CONFLICT' WHERE id=?",
          s.f.entry.id,
        );
      if (["ALIAS_COLLISION", "LABEL_COLLISION", "LIMIT"].includes(mode)) {
        const other = {
          ...s.f.product,
          id: randomUUID(),
          label: mode === "LABEL_COLLISION" ? "Bananes jaunes" : "Autre",
        };
        await repo.upsertProduct(other, {
          commandId: randomUUID(),
          deviceId: s.scope.deviceId,
        });
        if (mode === "ALIAS_COLLISION")
          await repo.upsertAlias(
            {
              ...s.f.entry,
              id: randomUUID(),
              productId: other.id,
              status: "VALIDATED",
            } as Parameters<typeof repo.upsertAlias>[0],
            { commandId: randomUUID(), deviceId: s.scope.deviceId },
          );
        if (mode === "LIMIT")
          for (let n = 0; n < 2000; n++)
            await s.a.runAsync(
              "INSERT INTO products SELECT ?,store_id,label,category,nature,sales_unit,packaging_quantity,packaging_unit,packaging_source_label,family_id,subfamily_id,status,version,created_at,updated_at,deleted_at,sync_state,remote_version,dirty FROM products WHERE id=?",
              randomUUID(),
              other.id,
            );
      }
      if (mode === "IDENTIFIER_COLLISION") {
        // The remote canonical sync writer rejects duplicate identifiers as well.
        await repo.upsertIdentifier(
          { ...s.f.entry, id: randomUUID() } as Parameters<
            typeof repo.upsertIdentifier
          >[0],
          { commandId: randomUUID(), deviceId: s.scope.deviceId },
        );
      }
      const initial = s.counts();
      await expect(s.runtime.execute(s.request, s.authority)).rejects.toThrow();
      expect(s.counts()).toEqual(initial);
    } finally {
      s.db.close();
    }
  },
);
it.each([
  "PERMISSION",
  "FORGED",
  "DELETED_ASSISTANT",
  "DELETED_CARD",
  "CANCEL",
  "COMMIT",
])(
  "rolls back or refuses unauthorized work and deleted private proof (%s)",
  async (mode) => {
    const s = await setup();
    try {
      const initial = s.counts(),
        abort = new AbortController();
      if (mode === "PERMISSION") s.authority.canManageProducts = false;
      if (mode === "FORGED") s.authority.authorizedRequestJson = "{}";
      if (mode === "CANCEL") abort.abort();
      if (mode === "COMMIT") s.a.fail = true;
      if (["DELETED_ASSISTANT", "DELETED_CARD"].includes(mode)) {
        const original =
          mode === "DELETED_ASSISTANT" ? s.f.assistant : s.message;
        const changed = {
          ...s.f.chat.conversation,
          deletedMessageIds: [original.id],
        };
        await s.a.runAsync(
          "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
          JSON.stringify(changed),
          changed.id,
        );
      }
      await expect(
        s.runtime.execute(s.request, s.authority, abort.signal),
      ).rejects.toThrow();
      expect(s.counts()).toEqual(initial);
      expect(
        (await new ProductMasterRepository(s.a).getAlias(s.f.entry.id))?.entity,
      ).toEqual(s.f.entry);
    } finally {
      s.db.close();
    }
  },
);
it("chains a second pending child decision against the pending revision and leaves siblings unchanged", async () => {
  const s = await setup();
  try {
    await s.controller.confirm(s.message, false);
    const repo = new ProductMasterRepository(s.a),
      current = (await repo.getAlias(s.f.entry.id))!.entity;
    const sibling = {
      ...current,
      id: randomUUID(),
      alias: "Banane test",
      normalizedAlias: "BANANE TEST",
    };
    await repo.upsertAlias(sibling, {
      commandId: randomUUID(),
      deviceId: s.scope.deviceId,
    });
    const preview = {
      ...s.f.preview,
      input: { ...s.f.preview.input, decision: "REJECT" },
      before: { product: s.f.product, entry: current },
    };
    const card = buildIdentityReviewMessages(s.f.assistant, [preview])[0]!;
    await s.a.withExclusiveTransactionAsync((tx) =>
      applyCopilotRecord(tx, s.f.chat, "copilot_message", card).then(
        () => undefined,
      ),
    );
    expect((await s.controller.confirm(card, false)).status).toBe("COMPLETED");
    const rows = await s.a.getAllAsync<{ expected_remote_version: number }>(
      "SELECT expected_remote_version FROM sync_outbox WHERE entity_id=? ORDER BY local_sequence",
      current.id,
    );
    expect(rows.map((r) => r.expected_remote_version)).toEqual([3, 4]);
    expect((await repo.getAlias(current.id))?.entity.version).toBe(5);
    expect((await repo.getAlias(sibling.id))?.entity).toEqual(sibling);
  } finally {
    s.db.close();
  }
});
it.each(["OWNER", "STORE", "DELETED_PARENT"])(
  "rejects replay after losing private conversation authority (%s)",
  async (mode) => {
    const s = await setup();
    try {
      await s.runtime.execute(s.request, s.authority);
      const initial = s.counts();
      if (mode === "OWNER") s.authority.ownerId = randomUUID();
      if (mode === "STORE") s.authority.storeId = randomUUID();
      if (mode === "DELETED_PARENT")
        await s.a.runAsync(
          "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
          JSON.stringify({
            ...s.f.chat.conversation,
            deletedMessageIds: [s.f.assistant.id],
          }),
          s.f.chat.conversation.id,
        );
      await expect(s.runtime.execute(s.request, s.authority)).rejects.toThrow();
      expect(s.counts()).toEqual(initial);
    } finally {
      s.db.close();
    }
  },
);
