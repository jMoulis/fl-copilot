import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  visualActionFixture,
  visualActionDigest,
} from "../../../../scripts/test-visual-action-fixtures";
import { CopilotVisualActionController } from "./visual-action-controller";
const actions = ["ASSIGN_LIBRARY", "REMOVE_PRODUCT", "REVOKE_CURRENT"] as const;
const snapshot = (s: Awaited<ReturnType<typeof visualActionFixture>>) =>
  [
    "products",
    "visual_assets",
    "visual_identities",
    "product_visual_links",
    "sync_outbox",
    "local_jobs",
    "copilot_tool_results",
  ].map((t) => s.db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
it.each(actions)(
  "confirms %s through the canonical service, preserves sources/products and replays once",
  async (action) => {
    const s = await visualActionFixture(action);
    try {
      expect(s.state.status).toBe("READY");
      const products = s.db.raw.prepare("SELECT * FROM products").all(),
        oldCommands = s.db.raw
          .prepare("SELECT COUNT(*) n FROM sync_outbox")
          .get()!.n;
      const result = await s.controller.confirm(
        s.message,
        s.state.review!.basisHash,
        s.consent,
      );
      expect(result.status).toBe("COMPLETED");
      expect(
        s.db.raw.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n,
      ).toBe(Number(oldCommands) + 1);
      expect(s.db.raw.prepare("SELECT * FROM products").all()).toEqual(
        products,
      );
      const link = await s.library.get(
          "product_visual_link",
          s.f.storeId,
          s.f.link.id,
        ),
        asset = await s.library.get("visual_asset", s.f.storeId, s.f.asset.id);
      if (action === "ASSIGN_LIBRARY")
        expect(link!.entity).toMatchObject({
          visualIdentityId: s.identity.id,
          overrideAssetId: null,
          verification: "APPROVED",
          version: 2,
        });
      if (action === "REMOVE_PRODUCT")
        expect(link!.entity.deletedAt).not.toBeNull();
      if (action === "REVOKE_CURRENT")
        expect(asset!.entity.review.status).toBe("REVOKED");
      expect(asset!.entity.contentHash).toBe(s.f.asset.contentHash);
      expect(asset!.entity.provenance).toEqual(s.f.asset.provenance);
      const after = snapshot(s);
      expect(
        (
          await s.controller.confirm(
            s.message,
            s.state.review!.basisHash,
            s.consent,
          )
        ).result,
      ).toEqual(result.result);
      expect(snapshot(s)).toEqual(after);
    } finally {
      s.db.raw.close();
    }
  },
);
it.each([
  "ROLE",
  "ABORT",
  "HASH",
  "CANCEL_DURING_WRITE",
  "FAILED_JOURNAL",
] as const)(
  "refuses %s without a partial metadata, job, Outbox or result change",
  async (scenario) => {
    const s = await visualActionFixture();
    try {
      let current = true;
      const abort = new AbortController();
      if (scenario === "ABORT") abort.abort();
      const original = s.transaction.runAsync.bind(s.transaction);
      vi.spyOn(s.transaction, "runAsync").mockImplementation(
        async (sql, ...p) => {
          const result = await original(sql, ...p);
          if (
            scenario === "FAILED_JOURNAL" &&
            sql.startsWith("INSERT INTO copilot_tool_results")
          )
            throw Error("FIXTURE_DISK_FAILURE");
          if (
            scenario === "CANCEL_DURING_WRITE" &&
            sql.startsWith("INSERT INTO product_visual_links")
          )
            current = false;
          return result;
        },
      );
      const before = snapshot(s),
        controller =
          scenario === "ROLE"
            ? new CopilotVisualActionController(
                s.db,
                { ...s.scope, canManageVisualLibrary: false },
                visualActionDigest,
                randomUUID,
              )
            : s.controller;
      await expect(
        controller.confirm(
          s.message,
          scenario === "HASH" ? "0".repeat(64) : s.state.review!.basisHash,
          s.consent,
          abort.signal,
          () => current,
        ),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(before);
    } finally {
      s.db.raw.close();
    }
  },
);
it.each(["ASSIGN_LIBRARY", "REVOKE_CURRENT"] as const)(
  "does not infer the separate %s attestation from a general confirmation",
  async (action) => {
    const s = await visualActionFixture(action);
    try {
      const before = snapshot(s);
      await expect(
        s.controller.confirm(s.message, s.state.review!.basisHash, {
          photoReviewed: false,
          confirmGlobalRevoke: false,
          restoreAssociation: false,
        }),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(before);
    } finally {
      s.db.raw.close();
    }
  },
);
it("binds full metadata even when compact image properties did not change", async () => {
  const s = await visualActionFixture();
  try {
    const changed = {
      ...s.asset,
      provenance: {
        ...s.asset.provenance,
        confirmedAt: "2026-10-21T10:00:00.000Z",
      },
    };
    s.db.raw
      .prepare("UPDATE visual_assets SET payload_json=? WHERE id=?")
      .run(JSON.stringify(changed), s.asset.id);
    expect((await s.controller.open(s.message)).status).toBe("STALE");
    const before = snapshot(s);
    await expect(
      s.controller.confirm(s.message, s.state.review!.basisHash, s.consent),
    ).rejects.toThrow();
    expect(snapshot(s)).toEqual(before);
  } finally {
    s.db.raw.close();
  }
});
it("tolerates acknowledgement-only transport changes while metadata and eligibility remain identical", async () => {
  const s = await visualActionFixture();
  try {
    s.db.raw
      .prepare(
        "UPDATE product_visual_links SET dirty=1,sync_state='PENDING' WHERE id=?",
      )
      .run(s.f.link.id);
    const after = await s.controller.open(s.message);
    expect(after.status).toBe("READY");
    expect(after.review!.basisHash).toBe(s.state.review!.basisHash);
    await s.controller.confirm(s.message, s.state.review!.basisHash, s.consent);
  } finally {
    s.db.raw.close();
  }
});
it("reopens a committed operation from file-backed SQLite without another business packet", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    { DatabaseSync } = await import("node:sqlite"),
    { VisualTestDatabase } =
      await import("../../../../scripts/test-visual-sqlite");
  const dir = mkdtempSync(join(tmpdir(), "visual-actions-")),
    path = join(dir, "local.db"),
    s = await visualActionFixture("REMOVE_PRODUCT", path);
  let reopened: InstanceType<typeof DatabaseSync> | undefined;
  try {
    const result = await s.controller.confirm(
        s.message,
        s.state.review!.basisHash,
        s.consent,
      ),
      rows = s.db.raw.prepare("SELECT * FROM sync_outbox ORDER BY rowid").all();
    s.db.raw.close();
    reopened = new DatabaseSync(path);
    const controller = new CopilotVisualActionController(
      new VisualTestDatabase(reopened),
      s.scope,
      visualActionDigest,
      randomUUID,
    );
    expect(
      (
        await controller.confirm(
          s.message,
          s.state.review!.basisHash,
          s.consent,
        )
      ).result,
    ).toEqual(result.result);
    expect(
      reopened.prepare("SELECT * FROM sync_outbox ORDER BY rowid").all(),
    ).toEqual(rows);
  } finally {
    if (reopened) reopened.close();
    else s.db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("requires explicit restoration of a previously removed product-image association", async () => {
  const s = await visualActionFixture("ASSIGN_LIBRARY", ":memory:", {
    retiredAssociation: true,
  });
  try {
    expect(s.state.status).toBe("READY");
    const before = snapshot(s);
    await expect(
      s.controller.confirm(s.message, s.state.review!.basisHash, s.consent),
    ).rejects.toThrow();
    expect(snapshot(s)).toEqual(before);
    await s.controller.confirm(s.message, s.state.review!.basisHash, {
      ...s.consent,
      restoreAssociation: true,
    });
    expect(
      (await s.library.get("product_visual_link", s.f.storeId, s.f.link.id))!
        .entity.deletedAt,
    ).toBeNull();
  } finally {
    s.db.raw.close();
  }
});
it("global withdrawal cancels only this asset’s transfer jobs and preserves their original payloads", async () => {
  const s = await visualActionFixture("REVOKE_CURRENT"),
    { enqueueVisualFileJob } = await import("../products/visual-file-jobs");
  try {
    await s.db.withExclusiveTransactionAsync(async (tx) => {
      for (const asset of [s.f.asset, s.asset])
        await enqueueVisualFileJob(
          tx,
          {
            storeId: s.f.storeId,
            ownerId: s.f.actorId,
            assetId: asset.id,
            sourceHash: asset.contentHash,
            variant: "PREVIEW",
          },
          randomUUID,
          s.f.at,
        );
    });
    const before = s.db.raw
      .prepare("SELECT id,payload_json FROM local_jobs ORDER BY id")
      .all();
    await s.controller.confirm(s.message, s.state.review!.basisHash, s.consent);
    const after = s.db.raw
      .prepare("SELECT id,payload_json,status FROM local_jobs ORDER BY id")
      .all();
    expect(after.map(({ id, payload_json }) => ({ id, payload_json }))).toEqual(
      before,
    );
    for (const row of after)
      expect(row.status).toBe(
        JSON.parse(String(row.payload_json)).assetId === s.f.asset.id
          ? "CANCELLED"
          : "PENDING",
      );
  } finally {
    s.db.raw.close();
  }
});
it("model action input cannot carry native review, source hashes, scope or permission flags", async () => {
  const { visualActionInputSchema } = await import("@fl-copilot/domain"),
    s = await visualActionFixture();
  try {
    for (const extra of [
      { photoReviewed: true },
      { confirmGlobalRevoke: true },
      { restoreAssociation: true },
      { storeId: s.f.storeId },
      { actorId: s.f.actorId },
      { hash: "0".repeat(64) },
    ])
      expect(
        visualActionInputSchema.safeParse({ ...s.input, ...extra }).success,
      ).toBe(false);
  } finally {
    s.db.raw.close();
  }
});
