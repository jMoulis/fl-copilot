import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { executionLinkFixture } from "../../../../scripts/test-execution-link-fixtures";
import { MercalysTestDatabase } from "../../../../scripts/test-mercalys-sync-fixtures";
import {
  decisionDigest,
  saveDecision,
} from "../../../../scripts/test-copilot-decision-fixtures";
import {
  CopilotExecutionLinkRepository,
  applyExecutionLinkRecord,
} from "./execution-link-repository";
import { OutboxRepository } from "../sync/outbox-repository";
it("confirms and withdraws an exact version link offline, retaining history and both original business records through restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-link-")),
    path = join(dir, "device.db");
  let db = new MercalysTestDatabase(new DatabaseSync(path));
  const f = await executionLinkFixture(db);
  try {
    const before = JSON.stringify(
      await db.getFirstAsync(
        "SELECT payload_json FROM commercial_execution_tasks WHERE id=?",
        f.business.task.id,
      ),
    );
    let s = await f.repository.open(f.linkCard);
    expect(s.status).toBe("READY");
    s = await f.repository.save(f.linkCard, s.review);
    expect(s.status).toBe("CONFIRMED");
    const link = s.link!;
    expect((await f.repository.save(f.linkCard, s.review)).link).toEqual(link);
    db.db.close();
    db = new MercalysTestDatabase(new DatabaseSync(path));
    const repo = new CopilotExecutionLinkRepository(
      db,
      f.linkScope,
      decisionDigest,
      randomUUID,
      () => "2026-10-18T13:00:00.000Z",
    );
    s = await repo.open(f.linkCard);
    expect(s.link).toEqual(link);
    s = await repo.save(f.linkCard, s.review, true);
    expect(s.link).toMatchObject({
      version: 2,
      withdrawnAt: "2026-10-18T13:00:00.000Z",
      snapshot: link.snapshot,
    });
    expect(
      JSON.stringify(
        await db.getFirstAsync(
          "SELECT payload_json FROM commercial_execution_tasks WHERE id=?",
          f.business.task.id,
        ),
      ),
    ).toBe(before);
    const commands = await db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM sync_outbox WHERE entity_type='copilot_execution_link' ORDER BY local_sequence",
    );
    expect(commands.map((c) => JSON.parse(c.payload_json).version)).toEqual([
      1, 2,
    ]);
    expect(
      JSON.parse(
        (await db.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM copilot_decisions WHERE id=?",
          f.decision.id,
        ))!.payload_json,
      ),
    ).toEqual(f.decision);
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it.each(["CHOICE", "TASK", "SCOPE", "FORBIDDEN", "STALE_REVIEW", "CANCELLED"])(
  "refuses an unsafe confirmation and preserves the association intent without a command (%s)",
  async (mode) => {
    const f = await executionLinkFixture();
    try {
      const state = await f.repository.open(f.linkCard);
      let repo = f.repository;
      if (mode === "CHOICE") await saveDecision(f, "REJECT");
      if (mode === "TASK")
        await f.db.runAsync(
          "UPDATE commercial_execution_tasks SET sync_state='CONFLICT' WHERE id=?",
          f.business.task.id,
        );
      if (mode === "SCOPE" || mode === "FORBIDDEN")
        repo = new CopilotExecutionLinkRepository(
          f.db,
          {
            ...f.linkScope,
            ...(mode === "SCOPE"
              ? { ownerId: randomUUID() }
              : { canLink: false }),
          },
          decisionDigest,
          randomUUID,
        );
      const abort = new AbortController();
      if (mode === "CANCELLED") abort.abort();
      await expect(
        repo.save(
          f.linkCard,
          mode === "STALE_REVIEW" ? "old" : state.review,
          false,
          abort.signal,
        ),
      ).rejects.toThrow();
      expect(
        await f.db.getFirstAsync(
          "SELECT COUNT(*) AS n FROM copilot_execution_links",
        ),
      ).toEqual({ n: 0 });
    } finally {
      f.db.db.close();
    }
  },
);
it("rolls back the link when enqueue fails, and preserves pending withdrawal on an older acknowledgement/pull", async () => {
  const f = await executionLinkFixture();
  try {
    let s = await f.repository.open(f.linkCard);
    const enqueue = vi
      .spyOn(OutboxRepository.prototype, "enqueue")
      .mockRejectedValueOnce(Error("disk full"));
    await expect(f.repository.save(f.linkCard, s.review)).rejects.toThrow();
    enqueue.mockRestore();
    expect(
      await f.db.getFirstAsync(
        "SELECT COUNT(*) AS n FROM copilot_execution_links",
      ),
    ).toEqual({ n: 0 });
    s = await f.repository.save(f.linkCard, s.review);
    const first = s.link!;
    s = await f.repository.save(f.linkCard, s.review, true);
    await applyExecutionLinkRecord(f.db, f.scope, first, 1);
    expect((await f.repository.open(f.linkCard)).link?.version).toBe(2);
    await applyExecutionLinkRecord(f.db, f.scope, first);
    expect((await f.repository.open(f.linkCard)).syncState).toBe("PENDING");
    await applyExecutionLinkRecord(f.db, f.scope, s.link, 2);
    expect((await f.repository.open(f.linkCard)).syncState).toBe("SYNCED");
  } finally {
    f.db.db.close();
  }
});
it("retains a confirmed historical link after the current task or decision changes, without applying it to that new revision", async () => {
  const f = await executionLinkFixture();
  try {
    const s = await f.repository.open(f.linkCard),
      confirmed = await f.repository.save(f.linkCard, s.review);
    await saveDecision(f, "REJECT");
    await f.db.runAsync(
      "UPDATE commercial_execution_tasks SET sync_state='CONFLICT' WHERE id=?",
      f.business.task.id,
    );
    expect((await f.repository.open(f.linkCard)).link).toEqual(confirmed.link);
    const current = await f.repository.open(f.linkCard);
    expect(
      (await f.repository.save(f.linkCard, current.review, true)).link?.version,
    ).toBe(2);
  } finally {
    f.db.db.close();
  }
});

it("confirms a version-1 immutable association against a task carrying additional actual details without changing its snapshot", async () => {
  const f = await executionLinkFixture();
  try {
    const task = {
      ...f.business.task,
      actuals: {
        start: null,
        end: null,
        price: null,
        priceUnit: null,
        location: "TG entrée",
      },
    };
    await f.db.runAsync(
      "UPDATE commercial_execution_tasks SET payload_json=? WHERE id=?",
      JSON.stringify(task),
      task.id,
    );
    const review = await f.repository.open(f.linkCard);
    expect(review.status).toBe("READY");
    const saved = await f.repository.save(f.linkCard, review.review);
    expect(saved.link?.snapshot.task).not.toHaveProperty("actuals");
    expect(
      JSON.parse(
        (await f.db.getFirstAsync<{ payload_json: string }>(
          "SELECT payload_json FROM commercial_execution_tasks WHERE id=?",
          task.id,
        ))!.payload_json,
      ).actuals,
    ).toEqual(task.actuals);
  } finally {
    f.db.db.close();
  }
});
