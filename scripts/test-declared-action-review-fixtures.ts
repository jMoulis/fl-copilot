import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { actionExecutionFixture } from "./test-action-execution-fixtures";
import { actionReviewPerformance } from "./test-action-review-fixtures";
import type { ActionExecution } from "../packages/domain/src/index";
export async function declaredActionReviewFixture() {
  const n = await actionExecutionFixture();
  const s = await n.repository.open(n.actionCard);
  const declaration = (await n.repository.save(n.actionCard, s.review)).link!;
  const product = {
    _id: randomUUID(),
    storeId: n.storeId,
    label: "Tomate vrac",
  };
  const input = {
    executionId: declaration.id,
    expectedVersion: 1 as const,
    productId: product._id,
    before: { start: "2026-10-14", end: "2026-10-15" },
    during: { start: "2026-10-16", end: "2026-10-17" },
    after: { start: "2026-10-18", end: "2026-10-18" },
    aggregation: "SUM" as const,
    metrics: ["sales", "margin", "waste"] as Array<
      "sales" | "margin" | "waste"
    >,
  };
  const state = {
    declaration: declaration as ActionExecution | null,
    changeDeclaration: false,
    changeReference: false,
    declarationReads: 0,
    metricReads: 0,
    reads: [] as string[],
    performances: [
      actionReviewPerformance(n.storeId, product._id, "2026-10-14", "100", "5"),
      actionReviewPerformance(
        n.storeId,
        product._id,
        "2026-10-16",
        "200",
        "0",
        true,
      ),
      actionReviewPerformance(
        n.storeId,
        product._id,
        "2026-10-18",
        "150",
        null,
      ),
    ],
  };
  const db = {
    collection(name: string) {
      state.reads.push(name);
      return {
        async findOne(q: { _id: string; storeId: string; ownerId?: string }) {
          if (name === "actionExecutions") {
            state.declarationReads++;
            let d = state.declaration;
            if (state.changeDeclaration && state.declarationReads > 1 && d)
              d = {
                ...d,
                status: "WITHDRAWN",
                version: 2,
                withdrawnAt: "2026-10-18T12:01:00.000Z",
              };
            return d &&
              q._id === d.id &&
              q.storeId === d.storeId &&
              q.ownerId === d.ownerId
              ? { _id: d.id, ...structuredClone(d) }
              : null;
          }
          if (name === "products")
            return q._id === product._id && q.storeId === product.storeId
              ? product
              : null;
          throw Error("Unexpected collection");
        },
        find(q: { $or?: Array<{ date?: { $gte: string; $lte: string } }> }) {
          let rows: unknown[] = [];
          if (name === "productDailyPerformance") {
            state.metricReads++;
            rows = structuredClone(
              state.performances.filter((r) =>
                q.$or?.some(
                  (p) =>
                    p.date && r.date >= p.date.$gte && r.date <= p.date.$lte,
                ),
              ),
            );
            if (state.changeReference && state.metricReads > 1)
              for (const row of rows as typeof state.performances)
                if (row.date === "2026-10-14")
                  row.performance.sales.salesValue = "101";
          } else if (name !== "storeProductEvents")
            throw Error("Unexpected collection");
          return {
            sort() {
              return this;
            },
            maxTimeMS() {
              return this;
            },
            limit(n: number) {
              rows = rows.slice(0, n);
              return this;
            },
            async toArray() {
              return rows;
            },
          };
        },
      };
    },
  } as unknown as Db;
  return {
    n,
    product,
    input,
    declaration,
    db,
    state,
    scope: { storeId: n.storeId, ownerId: n.ownerId },
  };
}
