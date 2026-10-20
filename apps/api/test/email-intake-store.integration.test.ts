import { createHmac, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Resend } from "resend";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMongoDatabase } from "../src/database/mongo.js";
import { parseEnvironment } from "../src/config.js";
import type { DatabaseService } from "../src/database/types.js";
import { createEmailIntakeStore } from "../src/intake/email-intake-store.js";
import { verifyResendReceivedEvent } from "../src/intake/resend-event.js";
import { registerResendIntakeWebhook } from "../src/intake/resend-webhook.js";
const key = Buffer.alloc(32, 9),
  secret = `whsec_${key.toString("base64")}`;
const client = new Resend("test-only-unused");
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "durable private email source admission",
  () => {
    let database: DatabaseService;
    beforeAll(async () => {
      database = createMongoDatabase(
        parseEnvironment({
          NODE_ENV: "test",
          MONGODB_URI: uri,
          MONGODB_DATABASE: `flc_email_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        }),
      );
      await database.getDb();
    }, 60000);
    afterAll(async () => {
      if (database)
        try {
          await (await database.getDb()).dropDatabase();
        } finally {
          await database.close();
        }
    }, 60000);
    async function fixture() {
      const db = await database.getDb(),
        scope = {
          storeId: randomUUID(),
          ownerId: randomUUID(),
          conversationId: randomUUID(),
        };
      await db.collection("storeMemberships").insertOne({
        storeId: scope.storeId,
        userId: scope.ownerId,
        active: true,
        role: "MANAGER",
      });
      await db
        .collection<{
          _id: string;
          storeId: string;
          ownerId: string;
          status: string;
          deletedAt: null;
        }>("copilotConversations")
        .insertOne({
          _id: scope.conversationId,
          storeId: scope.storeId,
          ownerId: scope.ownerId,
          status: "ACTIVE",
          deletedAt: null,
        });
      const service = createEmailIntakeStore(
        database,
        "unit.resend.app",
        () => new Date("2026-10-20T12:00:00Z"),
      );
      const request = {
        id: randomUUID(),
        conversationId: scope.conversationId,
        allowedSender: "manager@example.test",
      };
      const binding = await service.createBinding(
        { storeId: scope.storeId, ownerId: scope.ownerId },
        request,
      );
      const event = {
        type: "email.received",
        created_at: "2026-10-20T12:00:00Z",
        data: {
          email_id: randomUUID(),
          from: request.allowedSender,
          to: [binding.recipient],
          bcc: [] as string[],
          received_for: [] as string[],
          subject: "Semaine 43",
          message_id: `<${randomUUID()}@example.test>`,
          attachments: [
            {
              id: randomUUID(),
              filename: "ventes.zip",
              content_type: "application/zip",
              content_id: null,
              content_disposition: "attachment",
            },
          ],
        },
      };
      const signed = (
        id = `msg_${randomUUID()}`,
        payload = JSON.stringify(event),
      ) => {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac("sha256", key)
          .update(`${id}.${timestamp}.${payload}`)
          .digest("base64");
        return {
          body: payload,
          secret,
          headers: {
            "svix-id": id,
            "svix-timestamp": timestamp,
            "svix-signature": `v1,${signature}`,
          },
        };
      };
      const verified = (id?: string) =>
        verifyResendReceivedEvent(client, signed(id))!;
      return { db, scope, service, request, binding, event, signed, verified };
    }
    it("keeps one opaque recipient across retries and never reactivates or retargets a revoked binding", async () => {
      const f = await fixture();
      expect(f.binding.recipient).toMatch(
        /^fl-[a-f0-9]{48}@unit\.resend\.app$/,
      );
      const retry = await f.service.createBinding(f.scope, f.request);
      expect(retry).toEqual(f.binding);
      await expect(
        f.service.createBinding(f.scope, {
          ...f.request,
          allowedSender: "other@example.test",
        }),
      ).rejects.toMatchObject({ publicCode: "EMAIL_INTAKE_BINDING_CONFLICT" });
      await f.service.revokeBinding(f.scope, f.binding.id);
      const revoked = await f.service.createBinding(f.scope, f.request);
      expect(revoked.revokedAt).not.toBeNull();
      const next = await f.service.createBinding(f.scope, {
        ...f.request,
        id: randomUUID(),
      });
      expect(next.recipient).not.toBe(f.binding.recipient);
      f.event.data.to = [f.binding.recipient];
      await f.service.admit(f.verified());
      expect(
        await f.db
          .collection("emailIntakeReceipts")
          .countDocuments({ providerEmailId: f.event.data.email_id }),
      ).toBe(0);
    });
    it("admits one durable private envelope and stable file IDs under concurrent provider retries, without business publication", async () => {
      const f = await fixture(),
        event = f.verified();
      await Promise.all(
        Array.from({ length: 8 }, () => f.service.admit(event)),
      );
      const first = (await f.service.list(f.scope)).receipts[0]!;
      expect(first).toMatchObject({
        storeId: f.scope.storeId,
        ownerId: f.scope.ownerId,
        conversationId: f.scope.conversationId,
        status: "AWAITING_CONFIRMATION",
        version: 1,
        files: [
          { filename: "ventes.zip", status: "PENDING", sourceDocumentId: null },
        ],
      });
      const secondService = createEmailIntakeStore(database, "unit.resend.app");
      await Promise.all(
        Array.from({ length: 5 }, () => secondService.admit(f.verified())),
      );
      const after = (await secondService.list(f.scope)).receipts;
      expect(after).toEqual([first]);
      expect(
        await f.db
          .collection("emailIntakeReceipts")
          .countDocuments({ providerEmailId: f.event.data.email_id }),
      ).toBe(1);
      expect(
        await f.db
          .collection("emailIntakeEvents")
          .countDocuments({ providerEmailId: f.event.data.email_id }),
      ).toBe(6);
      for (const name of [
        "sourceDocuments",
        "sourceUploads",
        "dailySales",
        "dailyWaste",
        "commercialDocumentJobs",
        "copilotMessages",
      ])
        expect(
          await f.db
            .collection(name)
            .countDocuments({ storeId: f.scope.storeId }),
        ).toBe(0);
    });
    it.each(["different-email-event", "different-event-subject"])(
      "quarantines %s contradictions without overwriting the first source metadata",
      async (mode) => {
        const f = await fixture(),
          verified = f.verified();
        await f.service.admit(verified);
        const first = (await f.service.list(f.scope)).receipts[0]!;
        if (mode === "different-email-event")
          f.event.data.email_id = randomUUID();
        else f.event.data.subject = "Contradiction";
        await f.service.admit(
          f.verified(
            mode === "different-email-event" ? verified.eventId : undefined,
          ),
        );
        const after = (await f.service.list(f.scope)).receipts;
        expect(after).toHaveLength(1);
        expect(after[0]).toEqual({
          ...first,
          status: "QUARANTINED",
          version: 2,
        });
        await f.service.admit(verified);
        expect((await f.service.list(f.scope)).receipts[0]!.status).toBe(
          "QUARANTINED",
        );
      },
    );
    it.each([
      "sender",
      "recipient",
      "revoked-membership",
      "role",
      "archived-conversation",
      "deleted-conversation",
      "empty",
    ])(
      "records %s deliveries without fetching files or creating operational data",
      async (mode) => {
        const f = await fixture();
        if (mode === "sender") f.event.data.from = "attacker@example.test";
        if (mode === "recipient") f.event.data.to = ["unknown@unit.resend.app"];
        if (mode === "revoked-membership")
          await f.db
            .collection("storeMemberships")
            .updateOne(
              { storeId: f.scope.storeId },
              { $set: { active: false } },
            );
        if (mode === "role")
          await f.db
            .collection("storeMemberships")
            .updateOne(
              { storeId: f.scope.storeId },
              { $set: { role: "ASSISTANT" } },
            );
        if (mode === "archived-conversation")
          await f.db
            .collection("copilotConversations")
            .updateOne(
              { storeId: f.scope.storeId },
              { $set: { status: "ARCHIVED" } },
            );
        if (mode === "deleted-conversation")
          await f.db
            .collection("copilotConversations")
            .updateOne(
              { storeId: f.scope.storeId },
              { $set: { deletedAt: new Date() } },
            );
        if (mode === "empty") f.event.data.attachments = [];
        const input = f.verified();
        await f.service.admit(input);
        await f.service.admit(input);
        expect(
          await f.db
            .collection("emailIntakeReceipts")
            .countDocuments({ providerEmailId: f.event.data.email_id }),
        ).toBe(0);
        expect(
          await f.db
            .collection("emailIntakeOriginalJobs")
            .countDocuments({ storeId: f.scope.storeId }),
        ).toBe(0);
        const ledger = await f.db
          .collection("emailIntakeEvents")
          .findOne({ providerEmailId: f.event.data.email_id });
        expect(ledger?.result).toBe(
          mode === "empty" ? "IGNORED_EMPTY" : "IGNORED_SCOPE",
        );
        expect(JSON.stringify(ledger)).not.toContain(f.event.data.from);
        expect(JSON.stringify(ledger)).not.toContain(f.binding.recipient);
      },
    );
    it("refuses one delivery routed to two private stores and protects setup/list/revocation from another owner", async () => {
      const f = await fixture(),
        other = await fixture();
      f.event.data.bcc = [other.binding.recipient];
      await f.service.admit(f.verified());
      expect(
        await f.db
          .collection("emailIntakeReceipts")
          .countDocuments({ providerEmailId: f.event.data.email_id }),
      ).toBe(0);
      await expect(
        f.service.list({ ...f.scope, ownerId: other.scope.ownerId }),
      ).rejects.toMatchObject({ publicCode: "EMAIL_INTAKE_FORBIDDEN" });
      await expect(
        f.service.revokeBinding(other.scope, f.binding.id),
      ).rejects.toMatchObject({ publicCode: "EMAIL_INTAKE_FORBIDDEN" });
      await expect(
        f.service.createBinding(other.scope, {
          ...f.request,
          conversationId: other.scope.conversationId,
        }),
      ).rejects.toMatchObject({ publicCode: "EMAIL_INTAKE_BINDING_CONFLICT" });
      expect((await f.service.list(f.scope)).bindings[0]!.revokedAt).toBeNull();
    });
    it("rolls back receipt creation when durable acknowledgement fails and admits a provider retry exactly once", async () => {
      const f = await fixture(),
        app = Fastify({ logger: false });
      await registerResendIntakeWebhook(app, {
        client,
        secret,
        admit: f.service.admit,
      });
      try {
        await f.db.command({
          collMod: "emailIntakeEvents",
          validator: { $jsonSchema: { required: ["testOnlyForceRollback"] } },
        });
        const input = f.signed();
        const result = await app.inject({
          method: "POST",
          url: "/api/v1/intake/resend",
          payload: input.body,
          headers: { ...input.headers, "content-type": "application/json" },
        });
        expect(result.statusCode).toBe(503);
        expect(
          await f.db
            .collection("emailIntakeReceipts")
            .countDocuments({ providerEmailId: f.event.data.email_id }),
        ).toBe(0);
        await f.db.command({ collMod: "emailIntakeEvents", validator: {} });
        const retry = await app.inject({
          method: "POST",
          url: "/api/v1/intake/resend",
          payload: input.body,
          headers: { ...input.headers, "content-type": "application/json" },
        });
        expect(retry.statusCode).toBe(200);
        expect((await f.service.list(f.scope)).receipts).toHaveLength(1);
        expect(
          await f.db
            .collection("emailIntakeOriginalJobs")
            .countDocuments({ storeId: f.scope.storeId }),
        ).toBe(1);
      } finally {
        await f.db.command({ collMod: "emailIntakeEvents", validator: {} });
        await app.close();
      }
    });
    it("paginates only the owned conversation without duplicates and rejects foreign cursors", async () => {
      const f = await fixture(),
        other = await fixture();
      for (let i = 0; i < 22; i++) {
        f.event.data.email_id = randomUUID();
        await f.service.admit(f.verified());
      }
      const first = await f.service.list(f.scope);
      expect(first.receipts).toHaveLength(20);
      expect(first.nextCursor).not.toBeNull();
      const second = await f.service.list(f.scope, first.nextCursor!);
      expect(second.receipts).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      expect(
        new Set([...first.receipts, ...second.receipts].map((r) => r.id)).size,
      ).toBe(22);
      await expect(
        other.service.list(other.scope, first.nextCursor!),
      ).rejects.toMatchObject({ publicCode: "EMAIL_INTAKE_CURSOR_INVALID" });
      await f.db
        .collection("storeMemberships")
        .updateOne({ storeId: f.scope.storeId }, { $set: { active: false } });
      await expect(f.service.list(f.scope)).rejects.toMatchObject({
        publicCode: "EMAIL_INTAKE_FORBIDDEN",
      });
    });
  },
);
