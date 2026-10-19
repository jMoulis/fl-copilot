import type { Db, ClientSession } from "mongodb";
import { declaredActionReviewFixture } from "./test-declared-action-review-fixtures";
import { readPeriodAnalysis } from "../apps/api/src/copilot/period-analysis-tool";
import {
  appendFactContext,
  factReadFromTool,
} from "../apps/api/src/copilot/fact-context";
export async function factContextFixture() {
  const f = await declaredActionReviewFixture();
  const records: Record<string, unknown> = {};
  const state = { failMetrics: false, hideOnMetrics: false };
  const scope = {
    storeId: f.n.storeId,
    ownerId: f.n.ownerId,
    conversationId: f.n.conversation.id,
  };
  const source = { _id: f.n.source.id, ...f.n.source },
    topic = { _id: f.n.conversation.id, ...f.n.conversation };
  const db = {
    collection(name: string) {
      if (name === "departmentDailyPerformance")
        return {
          find: () => ({
            sort() {
              return this;
            },
            limit() {
              return this;
            },
            next: async () => null,
          }),
        };
      if (
        [
          "copilotMessages",
          "copilotConversations",
          "copilotFactContexts",
        ].includes(name)
      )
        return {
          findOne: async (query: Record<string, unknown>) => {
            const row =
              name === "copilotMessages"
                ? source
                : name === "copilotConversations"
                  ? topic
                  : records[query._id as string];
            return row &&
              Object.entries(query).every(
                ([k, v]) => (row as Record<string, unknown>)[k] === v,
              )
              ? structuredClone(row)
              : null;
          },
          insertOne: async (r: { _id: string }) => {
            records[r._id] = structuredClone(r);
          },
        };
      if (name === "productDailyPerformance") {
        if (state.failMetrics) throw Error("Read failed");
        if (state.hideOnMetrics) Object.assign(topic, { status: "ARCHIVED" });
      }
      return f.db.collection(name);
    },
  } as unknown as Db;
  const periodInput = {
    productId: f.input.productId,
    currentPeriod: f.input.during,
    referencePeriod: f.input.before,
    aggregation: f.input.aggregation,
    metrics: ["waste", "sales"],
  };
  const result = await readPeriodAnalysis(db, f.n.storeId, periodInput);
  const trace = {
    reads: [
      factReadFromTool(
        JSON.stringify([
          "period",
          { ...periodInput, metrics: [...periodInput.metrics].sort() },
        ]),
        result,
      )!,
    ],
    complete: true,
  };
  const session = { inTransaction: () => true } as ClientSession;
  await appendFactContext(db, session, f.n.source, trace, [], false);
  return {
    ...f,
    db,
    scope,
    source,
    topic,
    records,
    trace,
    session,
    periodInput,
    result,
    control: state,
    contextInput: {
      sourceMessageId: f.n.source.id,
      quote: f.n.preview.input.quote,
    },
  };
}
