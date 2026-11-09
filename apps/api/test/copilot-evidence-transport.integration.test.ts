import { it, expect } from "vitest";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { commercialPlanFixture } from "../../../scripts/test-commercial-plan-fixtures";
import { storeContextFixture } from "../../../scripts/test-store-context-fixtures";
import { readCommercialPreparation } from "../src/copilot/commercial-preparation-tool";
import { readCommercialPlan } from "../src/copilot/commercial-plan-tool";
import { readCopilotStoreSettings } from "../src/copilot/store-settings-tool";
import { readRetailExpertise } from "../src/copilot/retail-expertise-tool";
import { createAnalyticalModelOutput } from "../src/copilot/analytical-model-output";
it.skipIf(!process.env.TEST_MONGODB_URI)(
  "preserves real preparation, plan, settings and expertise snapshots while shortening evidence transport",
  async () => {
    const client = await MongoClient.connect(process.env.TEST_MONGODB_URI!);
    const db = client.db(
      `fl_transport_measure_${randomUUID().replaceAll("-", "")}`,
    );
    try {
      const f = await commercialPlanFixture();
      await db
        .collection("commercialWeekPreparations")
        .insertOne({ _id: f.preparation.id, ...f.preparation } as never);
      await db
        .collection("commercialOfferChoices")
        .insertOne({ _id: f.choice.id, ...f.choice } as never);
      await db
        .collection("commercialWeekPlans")
        .insertOne({ _id: f.plan.id, ...f.plan } as never);
      const settings = {
        ...storeContextFixture(),
        id: f.storeId,
        storeId: f.storeId,
        merchandising: {
          activeTgCount: 2,
          implantation: null,
          circulation: null,
          zones: [],
        },
      };
      await db
        .collection("storeContextSettings")
        .insertOne({ _id: f.storeId, ...settings } as never);
      const input = {
        weekStart: f.preparation.weekStart,
        offset: 0,
        limit: 10,
      };
      const values = [
        [
          "commercial-preparation",
          await readCommercialPreparation(db, f.storeId, input),
        ],
        ["commercial-plan", await readCommercialPlan(db, f.storeId, input)],
        ["store-settings", await readCopilotStoreSettings(db, f.storeId, {})],
        [
          "retail-expertise",
          readRetailExpertise(
            { topics: ["DISPLAY_DESIGN", "FRESH_DISPLAY"] },
            "2026-11-09T12:00:00.000Z",
          ),
        ],
      ] as const;
      const transport = createAnalyticalModelOutput([]);
      values.forEach(([family, value]) => {
        const copy = structuredClone(value),
          p = transport.prepare(family, value, 3)!;
        p.accept();
        expect(value).toEqual(copy);
        expect(transport.factCount).toBe(0);
        const wire = p.wire as unknown as {
          evidence: {
            rows: unknown[][];
            details: Array<string | number[]>;
            detailParts?: string[];
          };
          remainingReads: number;
        };
        const { evidence, remainingReads, ...rest } = wire;
        const { evidence: canonicalEvidence, ...canonicalRest } = value;
        expect(rest).toEqual(canonicalRest);
        expect(remainingReads).toBe(3);
        expect(
          evidence.rows.map(
            (
              [ref, label, value, sourceType, factKind, detail, extra],
              index,
            ) => {
              expect(transport.bind({ evidenceId: ref })).toEqual({
                evidenceId: canonicalEvidence[index]!.id,
              });
              const text =
                detail === null ? undefined : evidence.details[Number(detail)];
              return {
                label,
                value,
                sourceType,
                factKind,
                ...(text === undefined
                  ? {}
                  : {
                      detail: Array.isArray(text)
                        ? text
                            .map((part) => evidence.detailParts![part])
                            .join("")
                        : text,
                    }),
                ...((extra as object) ?? {}),
              };
            },
          ),
        ).toEqual(
          canonicalEvidence.map(
            ({ id, sourceId, sourceVersion, ...fields }) => {
              void [id, sourceId, sourceVersion];
              return fields;
            },
          ),
        );
        expect(Buffer.byteLength(JSON.stringify(p.wire))).toBeLessThan(
          Buffer.byteLength(JSON.stringify(value)),
        );
      });
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
