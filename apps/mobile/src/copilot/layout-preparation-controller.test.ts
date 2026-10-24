import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  allocationSqliteFixture,
  AllocationSqliteAdapter,
} from "../../../../scripts/test-physical-allocation-sqlite";
import { testChoiceDigest } from "../../../../scripts/test-commercial-choice-fixtures";
import { nextLayout } from "../../../../scripts/test-store-layout-fixtures";
import { LayoutPreparationController } from "./layout-preparation-controller";
import { applyStoreLayout } from "../store/layout-repository";
import { applyCommercialPreparation } from "../commercial/week-preparation-repository";
import { applyProductMasterSnapshot } from "../products/apply-product-master";
import {
  CommercialPlanRepository,
  applyCommercialPlanRevision,
  readCommercialPlanRevisions,
} from "../commercial/week-plan-repository";
import { readWeekPlanContext } from "../commercial/week-plan-context";
import {
  commercialWeekPlanSchema,
  legacyPhysicalEntity,
} from "@fl-copilot/domain";
import {
  buildCommercialWeekPlan,
  commercialPlanNeedsReview,
} from "@fl-copilot/commercial-core";

it("creates once offline, reopens the file and replays without duplicating preparation history/Outbox or validating a commercial plan", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-allocation-")),
    path = join(dir, "local.db"),
    s = await allocationSqliteFixture(path);
  let reopened: DatabaseSync | undefined;
  try {
    const review = await s.controller.open(s.message);
    expect(review.status).toBe("READY");
    expect(s.counts().sync_outbox).toBe(0);
    await s.controller.confirm(s.message, null);
    const p = await s.repo.get(s.f.storeId, s.f.scenario.weekStart);
    expect(p?.entity.physicalAllocation).toEqual(s.f.scenario);
    expect(p?.syncState).toBe("PENDING");
    expect(s.counts()).toEqual({
      sync_outbox: 1,
      commercial_preparation_history: 1,
      copilot_tool_results: 1,
      commercial_week_plans: 0,
    });
    await s.controller.confirm(s.message, null);
    expect(s.counts().sync_outbox).toBe(1);
    s.db.close();
    reopened = new DatabaseSync(path);
    const c = new LayoutPreparationController(
      new AllocationSqliteAdapter(reopened),
      s.scope,
      testChoiceDigest,
      randomUUID,
      s.now,
    );
    expect((await c.open(s.message)).status).toBe("COMPLETED");
    await c.confirm(s.message, null);
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n,
    ).toBe(1);
  } finally {
    try {
      s.db.close();
    } catch {
      /* closed for restart */
    }
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("preserves notes, selection and TG identities in an existing draft, and carries the exact allocation into a separately validated plan", async () => {
  const s = await allocationSqliteFixture(":memory:", true);
  try {
    const state = await s.controller.open(s.message);
    expect(state.status).toBe("READY");
    await s.controller.confirm(s.message, state.before);
    const p = (await s.repo.get(s.f.storeId, s.f.scenario.weekStart))!.entity;
    expect(p.note).toContain("préserver");
    expect(p.placements).toEqual(s.f.preparation.placements);
    expect(p.offerRefs).toEqual(s.f.preparation.offerRefs);
    const ctx = await readWeekPlanContext(s.a, p),
      plan = await buildCommercialWeekPlan(
        {
          preparation: p,
          version: 1,
          createdAt: p.createdAt,
          validatedAt: s.now(),
        },
        ctx,
        testChoiceDigest,
      );
    await new CommercialPlanRepository(s.a, testChoiceDigest).save(plan, {
      commandId: randomUUID(),
      deviceId: s.scope.deviceId,
    });
    expect(plan.preparation.physicalAllocation).toEqual(s.f.scenario);
    await applyProductMasterSnapshot(s.a, s.f.storeId, {
      products: [
        { ...s.f.layout.product, version: 2, label: "Nouvelle description" },
      ],
      productAliases: [],
      productIdentifiers: [],
    });
    expect(
      commercialPlanNeedsReview(plan, await readWeekPlanContext(s.a, p)),
    ).toContainEqual(
      expect.objectContaining({ code: "PHYSICAL_ALLOCATION_REVIEW_REQUIRED" }),
    );
  } finally {
    s.db.close();
  }
});
it.each([
  "PREPARATION",
  "REFERENCE",
  "PRODUCT",
  "OFFER_CONFLICT",
  "ROLE",
  "PRIVATE_CARD",
])(
  "refuses changed authority or sources without a partial write: %s",
  async (mode) => {
    const s = await allocationSqliteFixture();
    try {
      const state = await s.controller.open(s.message);
      if (mode === "PREPARATION")
        await applyCommercialPreparation(s.a, s.f.storeId, s.f.preparation);
      if (mode === "REFERENCE") {
        const id = randomUUID();
        await applyStoreLayout(
          s.a,
          s.f.storeId,
          nextLayout(s.f.layout.reference, {
            action: "ADOPT_REFERENCE",
            revisionId: id,
            referenceRevisionId: id,
          }),
        );
      }
      if (mode === "PRODUCT")
        await applyProductMasterSnapshot(s.a, s.f.storeId, {
          products: [{ ...s.f.layout.product, version: 2 }],
          productAliases: [],
          productIdentifiers: [],
        });
      if (mode === "OFFER_CONFLICT")
        s.db
          .prepare(
            "UPDATE commercial_offer_choices SET sync_state='CONFLICT' WHERE id=? AND store_id=?",
          )
          .run(s.f.choice.id, s.f.storeId);
      if (mode === "PRIVATE_CARD")
        s.db
          .prepare("UPDATE copilot_conversations SET payload_json=? WHERE id=?")
          .run(
            JSON.stringify({ ...s.chat.conversation, status: "ARCHIVED" }),
            s.chat.conversation.id,
          );
      const c =
        mode === "ROLE"
          ? new LayoutPreparationController(
              s.a,
              { ...s.scope, canPrepareCommercialWeek: false },
              testChoiceDigest,
              randomUUID,
            )
          : s.controller;
      await expect(c.confirm(s.message, state.before)).rejects.toThrow();
      expect(s.counts().sync_outbox).toBe(0);
      expect(s.counts().copilot_tool_results).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it("rolls back draft/history/Outbox when the private result fails, and cancels before a write", async () => {
  const s = await allocationSqliteFixture();
  try {
    s.db.exec(
      "CREATE TRIGGER fail_allocation_result BEFORE INSERT ON copilot_tool_results BEGIN SELECT RAISE(ABORT,'RESULT_FAILED'); END",
    );
    await expect(s.controller.confirm(s.message, null)).rejects.toThrow(
      "RESULT_FAILED",
    );
    expect(await s.repo.get(s.f.storeId, s.f.scenario.weekStart)).toBeNull();
    expect(s.counts().sync_outbox).toBe(0);
    expect(s.counts().commercial_preparation_history).toBe(0);
    const abort = new AbortController();
    abort.abort();
    await expect(
      s.controller.confirm(s.message, null, abort.signal),
    ).rejects.toThrow("CANCELLED");
  } finally {
    s.db.close();
  }
});
it("requires deliberate unlinking, preserves historical source and hydrates an older cache projection only once", async () => {
  const s = await allocationSqliteFixture();
  try {
    await s.controller.confirm(s.message, null);
    const p = (await s.repo.get(s.f.storeId, s.f.scenario.weekStart))!.entity,
      { physicalAllocation, ...without } = p;
    void physicalAllocation;
    await expect(
      s.repo.save(
        { ...without, version: 2 },
        { commandId: randomUUID(), deviceId: s.scope.deviceId },
      ),
    ).rejects.toThrow("EXPLICIT_REMOVAL");
    await s.repo.save(
      { ...p, physicalAllocation: null, version: 2 },
      { commandId: randomUUID(), deviceId: s.scope.deviceId },
    );
    expect(
      (await s.repo.get(s.f.storeId, s.f.scenario.weekStart))?.entity
        .physicalAllocation,
    ).toBeNull();
    const revision = {
      id: s.f.linkedPlan.revisionId,
      storeId: s.f.storeId,
      plan: s.f.linkedPlan,
      version: 1 as const,
    };
    await applyCommercialPlanRevision(
      s.a,
      s.f.storeId,
      legacyPhysicalEntity("commercial_week_plan_revision", revision),
    );
    await applyCommercialPlanRevision(s.a, s.f.storeId, revision);
    expect(
      (
        await readCommercialPlanRevisions(s.a, s.f.storeId, s.f.linkedPlan.id)
      )[0]?.plan.preparation.physicalAllocation,
    ).toEqual(s.f.scenario);
    const changed = structuredClone(revision);
    changed.plan.preparation.physicalAllocation!.assignments[0]!.reason =
      "Altération de la source historique";
    expect(commercialWeekPlanSchema.safeParse(changed.plan).success).toBe(true);
    await expect(
      applyCommercialPlanRevision(s.a, s.f.storeId, changed),
    ).rejects.toThrow("IMMUTABLE");
  } finally {
    s.db.close();
  }
});
