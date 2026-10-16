import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
import { runMongoMigrations } from "../src/database/migrations";
import { createCopilotWebResearchJournal } from "../src/copilot/web-research-journal";
import { CopilotResearchError } from "../src/copilot/web-research";
import {
  publicWebResearchRequestSchema,
  type PublicWebResearchResult,
} from "@fl-copilot/domain";

const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("durable public-research journal", () => {
  let client: MongoClient, db: Db;
  let fixture: ReturnType<typeof chatFixture>;
  const input = {
    query: "Saisonnalité des poires en France",
    purpose: "PRODUCE",
  };
  const answer = async (raw: unknown): Promise<PublicWebResearchResult> => ({
    ...publicWebResearchRequestSchema.parse(raw),
    kind: "EXTERNAL_RESEARCH",
    summaryFr: "Les périodes varient selon les variétés.",
    accessedAt: "2026-10-16T10:00:00.000Z",
    model: "test-model",
    inputTokens: 10,
    outputTokens: 20,
    citations: [
      {
        url: "https://www.interfel.com/",
        title: "Interfel",
        start: 0,
        end: 12,
        publishedAt: null,
      },
    ],
  });
  const authority = () => ({
    storeId: fixture.storeId,
    ownerId: fixture.ownerId,
    canRespond: true,
  });
  const turn = () => ({
    conversationId: fixture.conversation.id,
    userMessageId: fixture.message.id,
  });
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(`fl_web_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
    await runMongoMigrations(db);
  });
  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });
  beforeEach(async () => {
    fixture = chatFixture(randomUUID);
    await db
      .collection<Document & { _id: string }>("copilotConversations")
      .insertOne({ _id: fixture.conversation.id, ...fixture.conversation });
    await db
      .collection<Document & { _id: string }>("copilotMessages")
      .insertOne({ _id: fixture.message.id, ...fixture.message });
  });
  it("reuses an immutable result across service restarts, preserving original freshness", async () => {
    const research = vi.fn(answer);
    const dependencies = { db, authorize: async () => authority(), research };
    const first = await createCopilotWebResearchJournal(dependencies)(
      turn(),
      input,
    );
    const second = await createCopilotWebResearchJournal(dependencies)(
      turn(),
      input,
    );
    expect(second).toEqual(first);
    expect(research).toHaveBeenCalledTimes(1);
    expect(research.mock.calls[0]![0]).toEqual({
      ...input,
      requestId: fixture.message.id,
    });
    expect(await db.collection("outboxCommands").countDocuments()).toBe(0);
    expect(await db.collection("salesObservations").countDocuments()).toBe(0);
    await expect(
      createCopilotWebResearchJournal(dependencies)(turn(), {
        ...input,
        query: "Culture des pommes en France",
      }),
    ).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    expect(research).toHaveBeenCalledTimes(1);
  });
  it("reserves before the provider and never steals an uncertain running call", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const research = vi.fn(async (raw: unknown) => {
      started();
      await waiting;
      return answer(raw);
    });
    const run = createCopilotWebResearchJournal({
      db,
      authorize: async () => authority(),
      research,
    });
    const first = run(turn(), input);
    await ready;
    await expect(run(turn(), input)).rejects.toMatchObject({
      code: "IN_PROGRESS",
    });
    expect(research).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
  it("does not repeat failed paid calls and stores no raw provider error", async () => {
    const research = vi.fn(async () => {
      throw Error("secret-provider-error");
    });
    const run = createCopilotWebResearchJournal({
      db,
      authorize: async () => authority(),
      research,
    });
    await expect(run(turn(), input)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await expect(run(turn(), input)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(research).toHaveBeenCalledTimes(1);
    const row = await db
      .collection<Document & { _id: string }>("copilotWebResearch")
      .findOne({ _id: fixture.message.id });
    expect(row).toMatchObject({ state: "FAILED", result: null });
    expect(JSON.stringify(row)).not.toContain("secret-provider-error");
  });
  it("fails closed on an invalid provider identity and never retries it", async () => {
    const research = vi.fn(async (raw: unknown) => ({
      ...(await answer(raw)),
      requestId: randomUUID(),
    }));
    const run = createCopilotWebResearchJournal({
      db,
      authorize: async () => authority(),
      research,
    });
    await expect(run(turn(), input)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await expect(run(turn(), input)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(research).toHaveBeenCalledTimes(1);
  });
  it("does not reclaim a stale reservation after process loss", async () => {
    const research = vi.fn(answer);
    const run = createCopilotWebResearchJournal({
      db,
      authorize: async () => authority(),
      research,
    });
    await run(turn(), input);
    await db
      .collection<Document & { _id: string }>("copilotWebResearch")
      .updateOne(
        { _id: fixture.message.id },
        {
          $set: {
            state: "RUNNING",
            result: null,
            startedAt: new Date("2000-01-01"),
          },
        },
      );
    const restarted = createCopilotWebResearchJournal({
      db,
      authorize: async () => authority(),
      research,
    });
    await expect(restarted(turn(), input)).rejects.toMatchObject({
      code: "IN_PROGRESS",
    });
    expect(research).toHaveBeenCalledTimes(1);
  });
  it("rejects foreign, archived, corrected or modified parents before returning cached data", async () => {
    const research = vi.fn(answer);
    let permission = authority();
    const run = createCopilotWebResearchJournal({
      db,
      authorize: async () => permission,
      research,
    });
    await run(turn(), input);
    permission = { ...permission, ownerId: randomUUID() };
    await expect(run(turn(), input)).rejects.toMatchObject({
      code: "PARENT_INVALID",
    });
    permission = authority();
    await db
      .collection<Document & { _id: string }>("copilotConversations")
      .updateOne(
        { _id: fixture.conversation.id },
        { $set: { status: "ARCHIVED" } },
      );
    await expect(run(turn(), input)).rejects.toMatchObject({
      code: "PARENT_INVALID",
    });
    await db
      .collection<Document & { _id: string }>("copilotConversations")
      .updateOne(
        { _id: fixture.conversation.id },
        { $set: { status: "ACTIVE" } },
      );
    await db
      .collection<Document & { _id: string }>("copilotMessages")
      .updateOne(
        { _id: fixture.message.id },
        { $set: { text: "Changed source" } },
      );
    await expect(run(turn(), input)).rejects.toMatchObject({
      code: "REQUEST_CONFLICT",
    });
    await db
      .collection<Document & { _id: string }>("copilotMessages")
      .insertOne({
        ...fixture.message,
        _id: randomUUID(),
        id: randomUUID(),
        supersedesMessageId: fixture.message.id,
      });
    await expect(run(turn(), input)).rejects.toMatchObject({
      code: "PARENT_INVALID",
    });
    expect(research).toHaveBeenCalledTimes(1);
  });
  it("rechecks revoked authority after a paid call without discarding reusable success", async () => {
    let allowed = true;
    const research = vi.fn(async (raw: unknown) => {
      allowed = false;
      return answer(raw);
    });
    const run = createCopilotWebResearchJournal({
      db,
      authorize: async () => ({ ...authority(), canRespond: allowed }),
      research,
    });
    await expect(run(turn(), input)).rejects.toMatchObject({
      code: "ACCESS_INVALID",
    });
    allowed = true;
    await expect(run(turn(), input)).resolves.toMatchObject({
      query: input.query,
    });
    expect(research).toHaveBeenCalledTimes(1);
  });
  it("rejects caller authority fields/secrets and pre-cancellation without reservation", async () => {
    const research = vi.fn(answer);
    const run = createCopilotWebResearchJournal({
      db,
      authorize: async () => authority(),
      research,
    });
    await expect(
      run(turn(), { ...input, storeId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      run(turn(), { ...input, query: "secret api_key=private" }),
    ).rejects.toThrow();
    await expect(run(turn(), input, AbortSignal.abort())).rejects.toMatchObject(
      { code: "CANCELLED" },
    );
    expect(
      await db
        .collection<Document & { _id: string }>("copilotWebResearch")
        .findOne({ _id: fixture.message.id }),
    ).toBeNull();
    expect(research).not.toHaveBeenCalled();
  });
  it("keeps cancellation uncertain after transport starts, but reuses a late successful result", async () => {
    const controller = new AbortController();
    const research = vi.fn(async (raw: unknown) => {
      controller.abort();
      return answer(raw);
    });
    const run = createCopilotWebResearchJournal({
      db,
      authorize: async () => authority(),
      research,
    });
    await expect(run(turn(), input, controller.signal)).rejects.toMatchObject({
      code: "CANCELLED",
    });
    await expect(run(turn(), input)).resolves.toMatchObject({
      kind: "EXTERNAL_RESEARCH",
    });
    expect(research).toHaveBeenCalledTimes(1);
    const other = chatFixture(randomUUID);
    await db
      .collection<Document & { _id: string }>("copilotConversations")
      .insertOne({ _id: other.conversation.id, ...other.conversation });
    await db
      .collection<Document & { _id: string }>("copilotMessages")
      .insertOne({ _id: other.message.id, ...other.message });
    const cancelled = vi.fn(async () => {
      throw new CopilotResearchError("CANCELLED");
    });
    const failed = createCopilotWebResearchJournal({
      db,
      authorize: async () => ({
        storeId: other.storeId,
        ownerId: other.ownerId,
        canRespond: true,
      }),
      research: cancelled,
    });
    const otherTurn = {
      conversationId: other.conversation.id,
      userMessageId: other.message.id,
    };
    await expect(failed(otherTurn, input)).rejects.toMatchObject({
      code: "CANCELLED",
    });
    await expect(failed(otherTurn, input)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
