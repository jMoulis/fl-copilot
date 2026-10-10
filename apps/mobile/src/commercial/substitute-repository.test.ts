import { applyNeedMembership } from "../needs/membership-repository";
import { needMembershipId } from "@fl-copilot/domain";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect, vi } from "vitest";
import { commercialPlanFixture } from "../../../../scripts/test-commercial-plan-fixtures";
import { testChoiceDigest } from "../../../../scripts/test-commercial-choice-fixtures";
import { needUnitFixture } from "../../../../scripts/test-need-unit-fixtures";
import {
  commercialOfferValidationSource,
  buildCommercialWeekPlan,
  commercialValidatedOfferId,
  commercialChoiceId,
} from "@fl-copilot/commercial-core";
import {
  productSubstitutionId,
  type ProductSubstitution,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import { applyProductMasterSnapshot } from "../products/apply-product-master";
import { applyCommercialVisualReading } from "./visual-repository";
import { applyCommercialChoice } from "./offer-choice-repository";
import { applyCommercialPreparation } from "./week-preparation-repository";
import { applyValidatedOffer } from "./validated-offer-repository";
import { applyCommercialPlan } from "./week-plan-repository";
import { applyNeedUnit } from "../needs/repository";
import { applyProductSubstitution } from "../needs/substitution-repository";
import { StoreProductEventRepository } from "../needs/store-event-repository";
import { WeeklySubstituteRepository } from "./substitute-repository";
import type { OutboxDatabase } from "../sync/outbox-repository";
class Adapter implements OutboxDatabase {
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
const at = "2026-10-10T12:00:00.000Z";
async function setup(secondOffer = false, marketSignal = true) {
  const f = await commercialPlanFixture(),
    candidate = { ...f.product, id: randomUUID(), label: "Raisin rouge" },
    need = { ...needUnitFixture(), storeId: f.storeId },
    proof = [
      {
        pageNumber: 1,
        quote: "Tension d’approvisionnement",
        region: null,
        verification: "TEXT_SUPPORTED" as const,
      },
    ];
  if (marketSignal)
    f.reading.reading!.operations[0]!.items[0]!.fields.push({
      name: "marketSignal",
      rawValue: "Tension d’approvisionnement",
      confidence: 1,
      validationStatus: "TO_VALIDATE",
      evidence: proof,
    });
  const validated = {
      ...f.validated,
      ...commercialOfferValidationSource(f.choice, [f.reading]),
    },
    choices = [f.choice],
    validations = [validated];
  const preparation = JSON.parse(
    JSON.stringify(f.preparation),
  ) as typeof f.preparation;
  if (secondOffer) {
    const source = { ...f.choice.source, itemIndex: 1 };
    const choice = {
      ...f.choice,
      id: await commercialChoiceId(f.storeId, source, testChoiceDigest),
      source,
      productId: candidate.id,
      rawProductLabel: candidate.label,
    };
    f.reading.reading!.operations[0]!.items.push({
      ...f.reading.reading!.operations[0]!.items[0]!,
      label: candidate.label,
    });
    choices.push(choice);
    validations.push({
      ...validated,
      id: await commercialValidatedOfferId(
        f.storeId,
        choice.id,
        1,
        testChoiceDigest,
      ),
      choice,
      ...commercialOfferValidationSource(choice, [f.reading]),
    });
    preparation.offerRefs.push({ choiceId: choice.id, choiceVersion: 1 });
    preparation.placements[0]!.offerIds.push(choice.id);
  }
  const plan = await buildCommercialWeekPlan(
    {
      preparation,
      version: 1,
      createdAt: f.plan.createdAt,
      validatedAt: f.plan.validatedAt,
    },
    {
      ...f.context,
      preparation,
      choices,
      validated: validations,
      pages: [f.reading],
      products: [f.product, candidate].map(({ id, label, version }) => ({
        id,
        label,
        version,
      })),
    },
    testChoiceDigest,
  );
  const relation: ProductSubstitution = {
    id: await productSubstitutionId(
      f.storeId,
      f.product.id,
      candidate.id,
      need.id,
      testChoiceDigest,
    ),
    storeId: f.storeId,
    sourceProductId: f.product.id,
    substituteProductId: candidate.id,
    needUnitId: need.id,
    needCompatibility: 0.8,
    usageCompatibility: 0.7,
    priceCompatibility: null,
    packagingCompatibility: null,
    observedSubstitution: null,
    relationshipScore: null,
    confidence: null,
    evidenceCount: 0,
    lastEvidenceAt: null,
    status: "VALIDATED",
    source: "MANUAL",
    humanConfirmed: true,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  const dir = mkdtempSync(join(tmpdir(), "fl-weekly-sub_")),
    path = join(dir, "local.db");
  let db = new DatabaseSync(path),
    tx = new Adapter(db);
  await runLocalMigrations(tx);
  await applyProductMasterSnapshot(tx, f.storeId, {
    products: [f.product, candidate],
    productIdentifiers: [],
    productAliases: [],
  });
  await applyNeedUnit(tx, f.storeId, need);
  await applyProductSubstitution(tx, f.storeId, relation);
  await applyCommercialVisualReading(tx, f.storeId, f.reading);
  for (const c of choices) await applyCommercialChoice(tx, f.storeId, c);
  await applyCommercialPreparation(tx, f.storeId, preparation);
  for (const v of validations) await applyValidatedOffer(tx, f.storeId, v);
  await applyCommercialPlan(tx, f.storeId, plan);
  return {
    ...f,
    plan,
    candidate,
    need,
    relation,
    get db() {
      return db;
    },
    get tx() {
      return tx;
    },
    get repo() {
      return new WeeklySubstituteRepository(tx);
    },
    reopen() {
      db.close();
      db = new DatabaseSync(path);
      tx = new Adapter(db);
    },
    dispose() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
it("finds weekly potential substitutes after restart with all network requests disabled without changing plan/events/Outbox", async () => {
  const f = await setup(),
    network = vi.fn(async () => {
      throw Error("OFFLINE");
    });
  vi.stubGlobal("fetch", network);
  try {
    f.reopen();
    const snapshot = await f.repo.read(f.storeId, f.plan.weekStart, f.plan, at);
    expect(snapshot.status).toBe("READY");
    if (snapshot.status !== "READY") throw Error("NOT_READY");
    expect(snapshot.items[0]).toMatchObject({
      tension: {
        source: "COMMERCIAL_DOCUMENT",
        association: "VALIDATED_OFFER",
      },
      candidates: [
        {
          productId: f.candidate.id,
          basis: "DECLARED",
          availability: "UNKNOWN",
        },
      ],
    });
    expect(network).not.toHaveBeenCalled();
    expect(
      f.db.prepare("SELECT COUNT(*) n FROM store_product_events").get()!.n,
    ).toBe(0);
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
    expect(
      JSON.parse(
        f.db
          .prepare("SELECT payload_json FROM commercial_week_plans WHERE id=?")
          .get(f.plan.id)!.payload_json as string,
      ),
    ).toEqual(f.plan);
  } finally {
    vi.unstubAllGlobals();
    f.dispose();
  }
});
it("keeps planned offers/TG and other announced tensions separate from behavioural ranking and actual execution", async () => {
  const f = await setup(true);
  try {
    const snapshot = await f.repo.read(f.storeId, f.plan.weekStart, f.plan, at);
    if (snapshot.status !== "READY") throw Error("NOT_READY");
    const candidate = snapshot.items.find(
      (i) => i.tension.productId === f.product.id,
    )!.candidates[0]!;
    expect(candidate.fit).toBe(0.75);
    expect(candidate.commercialContext.plannedOffers).toHaveLength(1);
    expect(candidate.commercialContext.placements[0]!.label).toBe("TG entrée");
    expect(candidate.commercialContext.otherTensions).toHaveLength(1);
    expect(candidate.commercialContext.waste).toBe("NOT_EVALUATED");
    expect(candidate.commercialContext.margin).toBeUndefined();
    expect(f.plan.operations[0]!.actualStart).toBeNull();
  } finally {
    f.dispose();
  }
});
it("takes a real offline candidate stockout into account but never turns the PDF announcement into an actual event", async () => {
  const f = await setup();
  try {
    await new StoreProductEventRepository(f.tx).create(
      f.storeId,
      {
        event: {
          id: randomUUID(),
          productId: f.candidate.id,
          type: "OUT_OF_STOCK",
          startedAt: "2026-10-10T10:00:00Z",
          clientCapturedAt: at,
        },
      },
      { commandId: randomUUID(), deviceId: randomUUID() },
    );
    const s = await f.repo.read(f.storeId, f.plan.weekStart, f.plan, at);
    if (s.status !== "READY") throw Error("NOT_READY");
    expect(s.items[0]!.candidates).toEqual([]);
    expect(s.items[0]!.lookup.excluded[0]!.reason).toBe("OUT_OF_STOCK");
    expect(
      f.db.prepare("SELECT COUNT(*) n FROM store_product_events").get()!.n,
    ).toBe(1);
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(1);
  } finally {
    f.dispose();
  }
});
it("suppresses foreign stores, stale versions, conflicted plans and obsolete weeks without overwriting cached facts", async () => {
  const f = await setup();
  try {
    expect(
      (await f.repo.read(randomUUID(), f.plan.weekStart, undefined, at)).status,
    ).toBe("NO_PLAN");
    expect(
      (
        await f.repo.read(
          f.storeId,
          f.plan.weekStart,
          { ...f.plan, version: 2 },
          at,
        )
      ).status,
    ).toBe("PLAN_CHANGED");
    expect(
      (
        await f.repo.read(
          f.storeId,
          f.plan.weekStart,
          f.plan,
          "2026-10-12T12:00:00Z",
        )
      ).status,
    ).toBe("PAST_WEEK");
    f.db
      .prepare(
        "UPDATE commercial_week_plans SET sync_state='CONFLICT' WHERE id=?",
      )
      .run(f.plan.id);
    expect(
      (await f.repo.read(f.storeId, f.plan.weekStart, f.plan, at)).status,
    ).toBe("PLAN_REVIEW");
    expect(
      f.db.prepare("SELECT COUNT(*) n FROM commercial_week_plans").get()!.n,
    ).toBe(1);
  } finally {
    f.dispose();
  }
});
it("does not reuse changed choices or missing validated source readings for a current suggestion", async () => {
  const f = await setup();
  try {
    const c = { ...f.choice, version: 2 };
    f.db
      .prepare("UPDATE commercial_offer_choices SET payload_json=? WHERE id=?")
      .run(JSON.stringify(c), c.id);
    expect(
      (await f.repo.read(f.storeId, f.plan.weekStart, f.plan, at)).status,
    ).toBe("PLAN_REVIEW");
    f.db
      .prepare("UPDATE commercial_offer_choices SET payload_json=? WHERE id=?")
      .run(JSON.stringify(f.choice), c.id);
    f.db
      .prepare("DELETE FROM commercial_visual_readings WHERE id=?")
      .run(f.reading.id);
    expect(
      (await f.repo.read(f.storeId, f.plan.weekStart, f.plan, at)).status,
    ).not.toBe("READY");
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
  } finally {
    f.dispose();
  }
});

it("does not propose action for a finished offer period within the current week", async () => {
  const f = await setup();
  try {
    const s = await f.repo.read(
      f.storeId,
      f.plan.weekStart,
      f.plan,
      "2026-10-11T12:00:00Z",
    );
    if (s.status !== "READY") throw Error("NOT_READY");
    expect(s.items).toEqual([]);
    expect(s.pastOfferCount).toBe(1);
  } finally {
    f.dispose();
  }
});
it("keeps a rejected relation excluded from weekly suggestions without reactivating it", async () => {
  const f = await setup();
  try {
    await applyProductSubstitution(f.tx, f.storeId, {
      ...f.relation,
      status: "REJECTED",
      version: 2,
    });
    const s = await f.repo.read(f.storeId, f.plan.weekStart, f.plan, at);
    if (s.status !== "READY") throw Error("NOT_READY");
    expect(s.items[0]!.candidates).toEqual([]);
    expect(s.items[0]!.lookup.excluded[0]!.reason).toBe("REJECTED");
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
  } finally {
    f.dispose();
  }
});

it("restores overlap warnings offline even when the PDF has no market tension, preserving source terms and plan/Outbox", async () => {
  const f = await setup(true, false),
    network = vi.fn(async () => {
      throw Error("OFFLINE");
    });
  vi.stubGlobal("fetch", network);
  try {
    f.reopen();
    const s = await f.repo.read(f.storeId, f.plan.weekStart, f.plan, at);
    if (s.status !== "READY") throw Error("NOT_READY");
    expect(s.items).toEqual([]);
    expect(s.overlaps).toHaveLength(1);
    expect(s.overlaps[0]!.support[0]!.kind).toBe("DIRECTED_SUBSTITUTION");
    expect(s.overlaps[0]!.start).toBe("2026-10-10");
    expect(s.overlaps[0]!.impact).toEqual({
      salesTransfer: null,
      lostSales: null,
      marginImpact: null,
    });
    expect(network).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
    expect(
      JSON.parse(
        f.db
          .prepare("SELECT payload_json FROM commercial_week_plans WHERE id=?")
          .get(f.plan.id)!.payload_json as string,
      ),
    ).toEqual(f.plan);
  } finally {
    vi.unstubAllGlobals();
    f.dispose();
  }
});
it("updates the alert when a confirmed relation is rejected or conflicted without reactivating it", async () => {
  const f = await setup(true, false);
  try {
    await applyProductSubstitution(f.tx, f.storeId, {
      ...f.relation,
      status: "REJECTED",
      version: 2,
    });
    let s = await f.repo.read(f.storeId, f.plan.weekStart, f.plan, at);
    if (s.status !== "READY") throw Error("NOT_READY");
    expect(s.overlaps).toEqual([]);
    await applyProductSubstitution(f.tx, f.storeId, {
      ...f.relation,
      version: 3,
    });
    f.db
      .prepare(
        "UPDATE product_substitutions SET sync_state='CONFLICT' WHERE id=?",
      )
      .run(f.relation.id);
    s = await f.repo.read(f.storeId, f.plan.weekStart, f.plan, at);
    if (s.status !== "READY") throw Error("NOT_READY");
    expect(s.overlaps).toEqual([]);
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
  } finally {
    f.dispose();
  }
});
it("supports a shared confirmed need independently of a rejected edge while exposing the correct basis", async () => {
  const f = await setup(true, false);
  try {
    await applyProductSubstitution(f.tx, f.storeId, {
      ...f.relation,
      status: "REJECTED",
      version: 2,
    });
    for (const productId of [f.product.id, f.candidate.id])
      await applyNeedMembership(f.tx, f.storeId, {
        id: await needMembershipId(
          f.storeId,
          productId,
          f.need.id,
          testChoiceDigest,
        ),
        storeId: f.storeId,
        productId,
        needUnitId: f.need.id,
        strength: 0.8,
        confidence: 0.6,
        primary: false,
        source: "MANUAL",
        status: "VALIDATED",
        humanConfirmed: true,
        version: 1,
        createdAt: at,
        updatedAt: at,
      });
    const s = await f.repo.read(f.storeId, f.plan.weekStart, f.plan, at);
    if (s.status !== "READY") throw Error("NOT_READY");
    expect(s.overlaps).toHaveLength(1);
    expect(s.overlaps[0]!.support.map((s) => s.kind)).toEqual(["SHARED_NEED"]);
    expect(
      JSON.parse(
        f.db
          .prepare("SELECT payload_json FROM product_substitutions WHERE id=?")
          .get(f.relation.id)!.payload_json as string,
      ).status,
    ).toBe("REJECTED");
    expect(f.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
  } finally {
    f.dispose();
  }
});
