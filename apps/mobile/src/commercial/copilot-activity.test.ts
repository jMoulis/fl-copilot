import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { actionExecutionFixture } from "../../../../scripts/test-action-execution-fixtures";
import {
  saveDecision,
  decisionDigest,
} from "../../../../scripts/test-copilot-decision-fixtures";
import { MercalysTestDatabase } from "../../../../scripts/test-mercalys-sync-fixtures";
import { CopilotActivityRepository } from "./copilot-activity";
import { applyActionExecutionRecord } from "../copilot/action-execution-repository";

async function fixture(db = new MercalysTestDatabase()) {
  const f = await actionExecutionFixture(db);
  await saveDecision(f, "ACCEPT");
  const initial = await f.repository.open(f.actionCard);
  const saved = await f.repository.save(f.actionCard, initial.review);
  return {
    ...f,
    execution: saved.link!,
    activity: new CopilotActivityRepository(db, f.scope, decisionDigest),
  };
}
it("reads actual choices and explicit realizations in one bounded query, preserving their distinction after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-activity-")),
    path = join(dir, "device.db");
  let db = new MercalysTestDatabase(new DatabaseSync(path));
  try {
    const f = await fixture(db),
      read = vi.spyOn(db, "getAllAsync"),
      before = db.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get();
    const result = await f.activity.page("2026-10-12");
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.entries.map((e) => e.status)).toEqual([
      "DECLARED_DONE",
      "ACCEPT",
    ]);
    expect(result.entries[1]).toMatchObject({
      label: f.input.quote,
      sourceAvailable: true,
      conversationAvailable: true,
    });
    expect(result.entries[0]).toMatchObject({
      label: f.input.action,
      conversationId: f.conversation.id,
      syncState: "PENDING",
    });
    expect(result.next).toBeNull();
    expect(db.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual(
      before,
    );
    db.db.close();
    db = new MercalysTestDatabase(new DatabaseSync(path));
    expect(
      await new CopilotActivityRepository(db, f.scope, decisionDigest).page(
        "2026-10-12",
      ),
    ).toEqual(result);
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("does not turn an accepted recommendation or an unconfirmed proposal into a realized action", async () => {
  const f = await actionExecutionFixture();
  try {
    await saveDecision(f, "POSTPONE");
    const repo = new CopilotActivityRepository(f.db, f.scope, decisionDigest);
    expect((await repo.page("2026-10-12", "EXECUTION")).entries).toEqual([]);
    expect(
      (await repo.page("2026-10-12", "DECISION")).entries[0],
    ).toMatchObject({ status: "POSTPONE", postponedUntil: "2026-10-25" });
  } finally {
    f.db.db.close();
  }
});
it("pages tied timestamps without duplication, filters independently, and excludes foreign owners/stores", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 24; i++) {
      const id = randomUUID();
      await applyActionExecutionRecord(f.db, f.scope, {
        ...f.execution,
        id,
        proposalMessageId: id,
        snapshot: { ...f.execution.snapshot, action: `Action ${i}` },
      });
    }
    const ids: string[] = [];
    let after;
    do {
      const page = await f.activity.page("2026-10-12", "EXECUTION", after);
      expect(page.entries.length).toBeLessThanOrEqual(10);
      ids.push(...page.entries.map((e) => e.id));
      after = page.next ?? undefined;
    } while (after);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(
      (await f.activity.page("2026-10-12", "DECISION")).entries,
    ).toHaveLength(1);
    for (const scope of [
      { ...f.scope, ownerId: randomUUID() },
      { ...f.scope, storeId: randomUUID() },
    ])
      expect(
        (
          await new CopilotActivityRepository(f.db, scope, decisionDigest).page(
            "2026-10-12",
          )
        ).entries,
      ).toEqual([]);
  } finally {
    f.db.db.close();
  }
});
it.each(["source", "assistant", "card"] as const)(
  "hides a logically removed %s quote while preserving the business record",
  async (field) => {
    const f = await fixture();
    try {
      const topic = { ...f.conversation, deletedMessageIds: [f[field].id] };
      await f.db.runAsync(
        "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
        JSON.stringify(topic),
        topic.id,
      );
      const entry = (await f.activity.page("2026-10-12", "DECISION"))
        .entries[0]!;
      expect(entry).toMatchObject({
        label: "Conseil conservé",
        sourceAvailable: false,
        status: "ACCEPT",
      });
      expect(JSON.stringify(entry)).not.toContain(f.input.quote);
    } finally {
      f.db.db.close();
    }
  },
);
it("retains immutable action declarations after conversation deletion without exposing a deleted quote or an invalid deep link", async () => {
  const f = await fixture();
  try {
    const topic = {
      ...f.conversation,
      status: "ARCHIVED",
      deletedAt: "2026-10-18T12:00:30.000Z",
      updatedAt: "2026-10-18T12:00:30.000Z",
      version: 2,
    };
    await f.db.runAsync(
      "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
      JSON.stringify(topic),
      topic.id,
    );
    const page = await f.activity.page("2026-10-12");
    expect(page.entries[0]).toMatchObject({
      label: f.input.action,
      status: "DECLARED_DONE",
      conversationAvailable: false,
    });
    expect(page.entries[1]).toMatchObject({
      label: "Conseil conservé",
      sourceAvailable: false,
      conversationAvailable: false,
    });
  } finally {
    f.db.db.close();
  }
});
it("uses the Paris week across the autumn DST boundary, and reports withdrawals in their own change week", async () => {
  const f = await fixture();
  try {
    const write = async (at: string, withdrawnAt: string | null = null) => {
      const id = randomUUID();
      await applyActionExecutionRecord(f.db, f.scope, {
        ...f.execution,
        id,
        proposalMessageId: id,
        createdAt: at,
        withdrawnAt,
        status: withdrawnAt ? "WITHDRAWN" : "DECLARED_DONE",
        version: withdrawnAt ? 2 : 1,
      });
      return id;
    };
    const sunday = await write("2026-10-25T22:59:59.000Z"),
      monday = await write("2026-10-25T23:00:00.000Z"),
      withdrawn = await write(
        "2026-10-18T14:00:00.000Z",
        "2026-10-25T23:01:00.000Z",
      );
    expect(
      (await f.activity.page("2026-10-19", "EXECUTION")).entries.map(
        (e) => e.id,
      ),
    ).toEqual([sunday]);
    expect(
      (await f.activity.page("2026-10-26", "EXECUTION")).entries.map(
        (e) => e.id,
      ),
    ).toEqual([withdrawn, monday]);
    await expect(f.activity.page("2026-10-20")).rejects.toThrow();
  } finally {
    f.db.db.close();
  }
});

it("does not disclose a substituted private quote and refuses a business payload with a foreign owner", async () => {
  const f = await fixture();
  try {
    const card = {
      ...f.card,
      text: f.card.text.replace(f.input.quote, "Autre conversation privée"),
    };
    await f.db.runAsync(
      "UPDATE copilot_messages SET payload_json=? WHERE id=?",
      JSON.stringify(card),
      card.id,
    );
    const page = await f.activity.page("2026-10-12", "DECISION");
    expect(page.entries[0]).toMatchObject({
      sourceAvailable: false,
      label: "Conseil conservé",
    });
    expect(JSON.stringify(page)).not.toContain("Autre conversation privée");
    const row = await f.db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_decisions WHERE id=?",
      page.entries[0]!.id,
    );
    await f.db.runAsync(
      "UPDATE copilot_decisions SET payload_json=? WHERE id=?",
      JSON.stringify({
        ...JSON.parse(row!.payload_json),
        ownerId: randomUUID(),
      }),
      page.entries[0]!.id,
    );
    await expect(f.activity.page("2026-10-12", "DECISION")).rejects.toThrow(
      "SCOPE_INVALID",
    );
  } finally {
    f.db.db.close();
  }
});

it("keeps the canonical verified card readable before older history is local, while respecting an explicit source tombstone", async () => {
  const f = await fixture();
  try {
    await f.db.runAsync("DELETE FROM copilot_messages WHERE id=?", f.source.id);
    expect(
      (await f.activity.page("2026-10-12", "DECISION")).entries[0],
    ).toMatchObject({ label: f.input.quote, sourceAvailable: true });
    await f.db.runAsync(
      "UPDATE copilot_conversations SET payload_json=? WHERE id=?",
      JSON.stringify({ ...f.conversation, deletedMessageIds: [f.source.id] }),
      f.conversation.id,
    );
    expect(
      (await f.activity.page("2026-10-12", "DECISION")).entries[0],
    ).toMatchObject({ label: "Conseil conservé", sourceAvailable: false });
  } finally {
    f.db.db.close();
  }
});
it("keeps business records readable with damaged private source or conversation metadata", async () => {
  const f = await fixture();
  try {
    await f.db.runAsync(
      "UPDATE copilot_messages SET payload_json='broken' WHERE id=?",
      f.card.id,
    );
    expect(
      (await f.activity.page("2026-10-12", "DECISION")).entries[0],
    ).toMatchObject({ status: "ACCEPT", sourceAvailable: false });
    await f.db.runAsync(
      "UPDATE copilot_conversations SET payload_json='broken' WHERE id=?",
      f.conversation.id,
    );
    const page = await f.activity.page("2026-10-12");
    expect(page.entries).toHaveLength(2);
    expect(page.entries.every((e) => !e.conversationAvailable)).toBe(true);
  } finally {
    f.db.db.close();
  }
});

it("shows the latest accept/adapt/postpone/reject choice without manufacturing a realization", async () => {
  const f = await actionExecutionFixture();
  try {
    const repo = new CopilotActivityRepository(f.db, f.scope, decisionDigest);
    for (const status of ["ACCEPT", "MODIFY", "POSTPONE", "REJECT"] as const) {
      const saved = await saveDecision(f, status);
      expect(
        (await repo.page("2026-10-12", "DECISION")).entries[0],
      ).toMatchObject({
        status,
        label:
          saved.decision!.revisions.at(-1)!.modifiedAction ?? f.input.quote,
      });
      expect((await repo.page("2026-10-12", "EXECUTION")).entries).toHaveLength(
        0,
      );
    }
  } finally {
    f.db.db.close();
  }
});
