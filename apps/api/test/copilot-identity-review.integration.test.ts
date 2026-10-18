import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { identityFixture } from "../../../scripts/test-identity-review-fixtures";
import { readIdentityReviewPreview } from "../src/copilot/identity-review-tool";
import {
  readIdentityReviewProposal,
  identityReviewAfter,
} from "@fl-copilot/domain";
import { runMongoMigrations } from "../src/database/migrations";
import { runCopilotTurn } from "../src/copilot/turn-service";
import { applyProductMasterCommand } from "../src/products/product-master";
import { syncCommandSchema } from "@fl-copilot/sync-contracts";
import type { CopilotAiProvider } from "../src/copilot/ai-provider";
import {
  detectCopilotConflicts,
  scoreCopilotPriorities,
} from "@fl-copilot/analytics-core";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)(
  "existing product identity review on disposable Atlas",
  () => {
    let client: MongoClient, db: Db;
    const collection = (name: string) =>
      db.collection<Document & { _id: string }>(name);
    beforeAll(async () => {
      client = await MongoClient.connect(uri!);
      db = client.db(
        `fl_identity_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      );
      await runMongoMigrations(db);
    });
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await client?.close();
      }
    });
    const document = <
      T extends { id: string; createdAt: string; updatedAt: string },
    >(
      e: T,
    ) => {
      const { id, ...value } = e;
      return {
        ...value,
        _id: id,
        createdAt: new Date(e.createdAt),
        updatedAt: new Date(e.updatedAt),
        schemaVersion: 1,
      };
    };
    async function fixture(
      kind: "ALIAS" | "IDENTIFIER" = "ALIAS",
      status: "TO_REVIEW" | "VALIDATED" | "REJECTED" = "TO_REVIEW",
    ) {
      const f = identityFixture(kind, status);
      await collection("products").insertOne(document(f.product));
      await collection(
        kind === "ALIAS" ? "productAliases" : "productIdentifiers",
      ).insertOne(document(f.entry));
      return f;
    }
    it.each(["ALIAS", "IDENTIFIER"] as const)(
      "prepares a targeted %s without writes and returns exact canonical provenance",
      async (kind) => {
        const f = await fixture(kind),
          result = await readIdentityReviewPreview(db, f.chat.storeId, f.input);
        expect(result).toMatchObject({
          status: "READY",
          input: f.input,
          before: f.before,
        });
        expect(
          await collection("syncChanges").countDocuments({
            storeId: f.chat.storeId,
          }),
        ).toBe(0);
        const foreign = await readIdentityReviewPreview(
          db,
          randomUUID(),
          f.input,
        );
        expect(foreign).toMatchObject({ status: "UNAVAILABLE", before: null });
        expect(JSON.stringify(foreign)).not.toContain(f.product.label);
      },
    );
    it.each(["MISSING", "WRONG_PARENT", "INACTIVE", "DELETED"])(
      "does not prepare unavailable or retargeted identities (%s)",
      async (mode) => {
        const f = await fixture(),
          input = { ...f.input };
        if (mode === "MISSING") input.entryId = randomUUID();
        if (mode === "WRONG_PARENT")
          await collection("productAliases").updateOne(
            { _id: input.entryId },
            { $set: { productId: randomUUID() } },
          );
        if (mode === "INACTIVE")
          await collection("products").updateOne(
            { _id: input.productId },
            { $set: { status: "INACTIVE" } },
          );
        if (mode === "DELETED")
          await collection("productAliases").updateOne(
            { _id: input.entryId },
            { $set: { deletedAt: new Date() } },
          );
        expect(
          await readIdentityReviewPreview(db, f.chat.storeId, input),
        ).toMatchObject({ status: "UNAVAILABLE", before: null });
      },
    );
    it("distinguishes an existing decision, a refusal and explicit reactivation preparation", async () => {
      const f = await fixture("ALIAS", "VALIDATED");
      expect(
        (await readIdentityReviewPreview(db, f.chat.storeId, f.input)).status,
      ).toBe("UNCHANGED");
      expect(
        (
          await readIdentityReviewPreview(db, f.chat.storeId, {
            ...f.input,
            decision: "REJECT",
          })
        ).status,
      ).toBe("READY");
      await collection("productAliases").updateOne(
        { _id: f.input.entryId },
        { $set: { status: "REJECTED" } },
      );
      const result = await readIdentityReviewPreview(
        db,
        f.chat.storeId,
        f.input,
      );
      expect(result.status).toBe("READY");
      expect(result.evidence[0]?.value).toContain("réactivation explicite");
      expect(
        (await collection("productAliases").findOne({ _id: f.input.entryId }))
          ?.status,
      ).toBe("REJECTED");
    });
    it.each(["VALIDATED", "REJECTED", "LABEL", "FOREIGN"])(
      "checks alias ambiguity without treating another refused/foreign mapping as trusted (%s)",
      async (mode) => {
        const f = await fixture(),
          other = {
            ...f.product,
            id: randomUUID(),
            label: mode === "LABEL" ? "Bananes jaunes" : "Autre",
            storeId: mode === "FOREIGN" ? randomUUID() : f.chat.storeId,
          };
        await collection("products").insertOne(document(other));
        await collection("productAliases").insertOne(
          document({
            ...f.entry,
            id: randomUUID(),
            productId: other.id,
            storeId: other.storeId,
            status: mode === "REJECTED" ? "REJECTED" : "VALIDATED",
          }),
        );
        expect(
          (await readIdentityReviewPreview(db, f.chat.storeId, f.input)).status,
        ).toBe(["VALIDATED", "LABEL"].includes(mode) ? "AMBIGUOUS" : "READY");
        expect(
          (
            await readIdentityReviewPreview(db, f.chat.storeId, {
              ...f.input,
              decision: "REJECT",
            })
          ).status,
        ).toBe("READY");
      },
    );
    it("fails closed when a complete active-label check exceeds the bound", async () => {
      const f = await fixture();
      await collection("products").insertMany(
        Array.from({ length: 2000 }, () =>
          document({ ...f.product, id: randomUUID(), label: "Autre" }),
        ),
      );
      expect(
        (await readIdentityReviewPreview(db, f.chat.storeId, f.input)).status,
      ).toBe("LIMIT_EXCEEDED");
    });
    it
      .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
      .each(["ALIAS", "IDENTIFIER"] as const)(
      "uses the existing canonical sync command for a reviewed %s and detects stale versions",
      async (kind) => {
        const f = await fixture(kind),
          after = identityReviewAfter(
            f.input,
            f.before,
            "2026-10-11T12:02:00.000Z",
          ),
          session = client.startSession(),
          append = vi.fn(async () => undefined);
        const command = syncCommandSchema.parse({
          commandId: randomUUID(),
          localSequence: 1,
          type:
            kind === "ALIAS"
              ? "PRODUCT_ALIAS_UPSERT"
              : "PRODUCT_IDENTIFIER_UPSERT",
          entityType: kind === "ALIAS" ? "product_alias" : "product_identifier",
          entityId: f.entry.id,
          expectedRemoteVersion: f.entry.version,
          createdAt: after.updatedAt,
          payload: after,
        });
        try {
          await session.withTransaction(async () => {
            const outcome = await applyProductMasterCommand(
              { database: db, session },
              f.chat.storeId,
              command,
              randomUUID(),
              () => new Date(after.updatedAt),
              { append },
            );
            expect(outcome.resultStatus).toBe("APPLIED");
          });
          expect(append).toHaveBeenCalledOnce();
          expect(
            (
              await collection(
                kind === "ALIAS" ? "productAliases" : "productIdentifiers",
              ).findOne({ _id: f.entry.id })
            )?.status,
          ).toBe("VALIDATED");
          await session.withTransaction(async () => {
            expect(
              (
                await applyProductMasterCommand(
                  { database: db, session },
                  f.chat.storeId,
                  { ...command, commandId: randomUUID() },
                  randomUUID(),
                  () => new Date(),
                  { append },
                )
              ).resultStatus,
            ).toBe("CONFLICT");
          });
        } finally {
          await session.endSession();
        }
      },
    );
    it
      .skipIf(process.env.TEST_MONGODB_TRANSACTIONS !== "true")
      .each([false, true])(
      "atomically commits the private card with the assistant and replays once (foreign=%s)",
      async (foreign) => {
        const f = await fixture(),
          chat = f.chat;
        await collection("copilotConversations").insertOne({
          _id: chat.conversation.id,
          ...chat.conversation,
        });
        await collection("copilotMessages").insertOne({
          _id: chat.message.id,
          ...chat.message,
        });
        const preview = await readIdentityReviewPreview(
          db,
          chat.storeId,
          f.input,
        );
        if (foreign && preview.before)
          preview.before.entry.storeId = randomUUID();
        const generate = vi.fn(async () => ({
          output: {
            language: "fr-FR",
            summary: "Décision préparée, à confirmer.",
            facts: preview.evidence.map((e) => ({ evidenceId: e.id })),
            interpretation: [],
            recommendations: [],
            questions: [],
          },
          metadata: {
            requestedModel: "test",
            resolvedModel: "test",
            responseId: "test-identity",
            inputTokens: null,
            outputTokens: null,
          },
          toolEvidence: preview.evidence,
          identityReviews: [preview],
        }));
        const deps = {
            db,
            provider: { model: "test", generate } as CopilotAiProvider,
            authorize: async () => ({
              storeId: chat.storeId,
              ownerId: chat.ownerId,
              canRespond: true,
            }),
            loadContext: async () =>
              detectCopilotConflicts({
                batch: scoreCopilotPriorities({
                  storeId: chat.storeId,
                  evaluatedAt: chat.message.createdAt,
                  candidates: [],
                }),
                intents: [],
              }),
          },
          turn = {
            conversationId: chat.conversation.id,
            userMessageId: chat.message.id,
            replyId: randomUUID(),
          };
        if (foreign) {
          await expect(runCopilotTurn(deps, turn)).rejects.toThrow();
          expect(
            await collection("copilotMessages").countDocuments({
              conversationId: chat.conversation.id,
              role: { $in: ["ASSISTANT", "TOOL"] },
            }),
          ).toBe(0);
        } else {
          await runCopilotTurn(deps, turn);
          const cards = await collection("copilotMessages")
            .find({ conversationId: chat.conversation.id, role: "TOOL" })
            .toArray();
          expect(cards).toHaveLength(1);
          const { _id: cardId, ...card } = cards[0]!;
          void cardId;
          expect(readIdentityReviewProposal(card).content.before).toEqual(
            f.before,
          );
          expect(
            await collection("syncChanges").countDocuments({
              entityId: cards[0]!._id,
            }),
          ).toBe(1);
          expect((await runCopilotTurn(deps, turn)).alreadyApplied).toBe(true);
          expect(generate).toHaveBeenCalledOnce();
        }
      },
    );
  },
);
