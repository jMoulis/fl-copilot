import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import {
  readProductImageRequest,
  retainProductImageRequest,
  finishProductImageRequest,
} from "./product-image-request";
it("retains the exact billable request across reopen, scopes by store/owner and never queues an automatic retry", async () => {
  const root = mkdtempSync(join(tmpdir(), "fl-image-request-")),
    path = join(root, "state.db");
  let db = new VisualTestDatabase(new DatabaseSync(path));
  const store = randomUUID(),
    owner = randomUUID(),
    input = {
      requestId: randomUUID(),
      productId: randomUUID(),
      productVersion: 1,
      policyId: "test-policy",
    };
  try {
    await runLocalMigrations(db);
    await retainProductImageRequest(
      db,
      store,
      owner,
      input,
      new Date().toISOString(),
    );
    expect(db.raw.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(
      0,
    );
    expect(
      db.raw
        .prepare(
          "SELECT COUNT(*) n FROM local_jobs WHERE status IN ('PENDING','RETRY','RUNNING')",
        )
        .get()!.n,
    ).toBe(0);
    db.raw.close();
    db = new VisualTestDatabase(new DatabaseSync(path));
    expect(
      await readProductImageRequest(db, store, owner, input.productId),
    ).toEqual(input);
    expect(
      await readProductImageRequest(db, store, randomUUID(), input.productId),
    ).toBeNull();
    expect(
      await readProductImageRequest(db, randomUUID(), owner, input.productId),
    ).toBeNull();
    await finishProductImageRequest(
      db,
      store,
      randomUUID(),
      input.requestId,
      false,
      new Date().toISOString(),
    );
    expect(
      await readProductImageRequest(db, store, owner, input.productId),
    ).toEqual(input);
    await finishProductImageRequest(
      db,
      store,
      owner,
      input.requestId,
      true,
      new Date().toISOString(),
    );
    expect(
      await readProductImageRequest(db, store, owner, input.productId),
    ).toBeNull();
  } finally {
    db.raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
