import { commercialExecutionFixture } from "./test-commercial-execution-fixtures";
import type { Db } from "mongodb";
export async function actionReviewFixture() {
  const f = await commercialExecutionFixture();
  const input = {
    weekStart: f.plan.weekStart,
    taskId: f.proposals.find((t) => t.kind === "INSTALL_TG")!.id,
    productId: f.product.id,
    before: { start: "2026-10-01", end: "2026-10-07" },
    during: { start: "2026-10-08", end: "2026-10-10" },
    after: { start: "2026-10-11", end: "2026-10-13" },
    aggregation: "SUM" as const,
    metrics: ["sales", "margin", "waste"] as Array<
      "sales" | "margin" | "waste"
    >,
  };
  const task = {
    ...f.task,
    ...f.proposals.find((t) => t.id === input.taskId)!,
  };
  return { ...f, task, input };
}
export function actionReviewPerformance(
  storeId: string,
  productId: string,
  date: string,
  sales: string | null,
  waste: string | null,
  partial = false,
) {
  const availability = (v: string | null) => ({
    status: v === null ? "UNAVAILABLE" : partial ? "PARTIAL" : "AVAILABLE",
    inputCount: partial ? 2 : 1,
    availableInputCount: v === null ? 0 : 1,
    missingInputCount: v === null || partial ? 1 : 0,
  });
  return {
    _id: productId + date,
    storeId,
    productId,
    date,
    performance: {
      storeId,
      productId,
      date,
      formulaVersion: "product-daily-v1",
      inputRevision: "v1",
      computedAt: "2026-10-14T12:00:00.000Z",
      sales: { salesValue: sales, marginValue: null },
      waste: { salesValue: waste },
      availability: {
        salesValue: availability(sales),
        salesMarginValue: availability(null),
        wasteSalesValue: availability(waste),
      },
    },
  };
}
/** Lightweight read-only transport for unit journeys; real Mongo scope is tested separately. */
export function actionReviewDatabase(
  f: Awaited<ReturnType<typeof actionReviewFixture>>,
) {
  const state = {
    plan: f.plan as typeof f.plan | null,
    tasks: [{ _id: f.task.id, ...f.task }],
    performances: [
      actionReviewPerformance(
        f.storeId,
        f.product.id,
        "2026-10-01",
        "100",
        "5",
      ),
      actionReviewPerformance(
        f.storeId,
        f.product.id,
        "2026-10-08",
        "200",
        "0",
        true,
      ),
      actionReviewPerformance(
        f.storeId,
        f.product.id,
        "2026-10-11",
        "150",
        null,
      ),
    ],
    planReads: 0,
    changePlan: false,
    changeReference: false,
  };
  let performanceReads = 0;
  const db = {
    collection: (name: string) => ({
      findOne: async () => {
        if (name === "commercialWeekPlans") {
          state.planReads++;
          if (state.changePlan && state.planReads > 1 && state.plan)
            return {
              _id: state.plan.id,
              ...structuredClone(state.plan),
              preparation: {
                ...state.plan.preparation,
                note: "Nouvelle préparation",
              },
            };
          return state.plan
            ? { _id: state.plan.id, ...structuredClone(state.plan) }
            : null;
        }
        return {
          _id: f.product.id,
          storeId: f.storeId,
          label: f.product.label,
        };
      },
      find: (query: {
        $or?: Array<{ date?: { $gte: string; $lte: string } }>;
      }) => {
        let rows: unknown[] =
          name === "commercialExecutionTasks"
            ? structuredClone(state.tasks)
            : [];
        if (name === "productDailyPerformance") {
          performanceReads++;
          rows = structuredClone(
            state.performances.filter((r) =>
              query.$or?.some(
                (q) => q.date && r.date >= q.date.$gte && r.date <= q.date.$lte,
              ),
            ),
          );
          if (state.changeReference && performanceReads > 1)
            for (const row of rows as typeof state.performances)
              if (row.date === "2026-10-01")
                row.performance.sales.salesValue = "101";
        }
        const cursor = {
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
        return cursor;
      },
    }),
  } as unknown as Db;
  return { db, state };
}
