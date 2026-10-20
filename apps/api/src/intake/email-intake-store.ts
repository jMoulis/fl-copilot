import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ClientSession, Db, Document } from "mongodb";
import { z } from "zod";
import {
  emailIntakeReceivingDomainSchema,
  emailIntakeBindingRequestSchema,
  emailIntakeBindingSchema,
  emailIntakeListSchema,
  emailIntakeReceiptSchema,
  type EmailIntakeBinding,
  type EmailIntakeBindingRequest,
  type EmailIntakeReceipt,
} from "@fl-copilot/sync-contracts";
import { AuthError } from "../auth/service.js";
import type { DatabaseService } from "../database/types.js";
import {
  chooseInboundBinding,
  declaredMailbox,
  type verifyResendReceivedEvent,
} from "./resend-event.js";

type VerifiedEvent = NonNullable<ReturnType<typeof verifyResendReceivedEvent>>;
type Binding = Omit<EmailIntakeBinding, "id" | "createdAt" | "revokedAt"> & {
  _id: string;
  createdAt: Date;
  revokedAt: Date | null;
};
type Receipt = Omit<EmailIntakeReceipt, "id" | "receivedAt" | "updatedAt"> & {
  _id: string;
  metadataHash: string;
  createdAt: Date;
  receivedAt: Date;
  updatedAt: Date;
  originalReservedBytes?: number;
};
type Event = {
  _id: string;
  providerEmailId: string;
  metadataHash: string;
  payloadHash: string;
  receiptId: string | null;
  result:
    | "ADMITTED"
    | "DUPLICATE"
    | "IGNORED_SCOPE"
    | "IGNORED_EMPTY"
    | "QUARANTINED";
  createdAt: Date;
};
export type EmailIntakeScope = {
  storeId: string;
  ownerId: string;
  conversationId: string;
};
const scopeSchema = z.strictObject({
  storeId: z.uuid(),
  ownerId: z.uuid(),
  conversationId: z.uuid(),
});
const cursorSchema = scopeSchema.extend({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});
const unavailable = () =>
  new AuthError(
    403,
    "EMAIL_INTAKE_FORBIDDEN",
    "La réception n’est pas disponible pour ce magasin ou cette conversation.",
  );
const conflict = () =>
  new AuthError(
    409,
    "EMAIL_INTAKE_BINDING_CONFLICT",
    "Cette adresse est déjà configurée. Relisez sa configuration avant de la modifier.",
  );
const bindingDto = (r: Binding) =>
  emailIntakeBindingSchema.parse({
    id: r._id,
    storeId: r.storeId,
    ownerId: r.ownerId,
    conversationId: r.conversationId,
    recipient: r.recipient,
    allowedSender: r.allowedSender,
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
  });
const receiptDto = (r: Receipt) =>
  emailIntakeReceiptSchema.parse({
    id: r._id,
    storeId: r.storeId,
    ownerId: r.ownerId,
    conversationId: r.conversationId,
    bindingId: r.bindingId,
    providerEmailId: r.providerEmailId,
    sender: r.sender,
    subject: r.subject,
    receivedAt: r.receivedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
    status: r.status,
    files: r.files,
  });

async function authorized(
  db: Db,
  scope: EmailIntakeScope,
  session?: ClientSession,
) {
  scopeSchema.parse(scope);
  const membership = await db.collection("storeMemberships").findOne(
    {
      storeId: scope.storeId,
      userId: scope.ownerId,
      active: true,
      role: "MANAGER",
    },
    { session, maxTimeMS: 2000 },
  );
  if (!membership) return false;
  const conversation = await db
    .collection<Document & { _id: string }>("copilotConversations")
    .findOne(
      {
        _id: scope.conversationId,
        storeId: scope.storeId,
        ownerId: scope.ownerId,
        status: "ACTIVE",
        deletedAt: null,
      },
      { session, maxTimeMS: 2000 },
    );
  return conversation !== null;
}

/** All admission effects are one transaction; duplicate-key races replay the same identities. */
async function atomic<T>(
  db: Db,
  task: (session: ClientSession) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const session = db.client.startSession();
    try {
      return await session.withTransaction(() => task(session), {
        maxCommitTimeMS: 5000,
      });
    } catch (error) {
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000 &&
        attempt < 2
      ))
        throw error;
    } finally {
      await session.endSession();
    }
  }
  throw Error("EMAIL_INTAKE_TRANSACTION_UNAVAILABLE");
}
function metadataHash(input: VerifiedEvent) {
  // Formatting/signature timestamps may change on a replay; the original metadata may not.
  return `sha256:${createHash("sha256").update(JSON.stringify(input.event.data)).digest("hex")}`;
}
export function createEmailIntakeStore(
  database: DatabaseService,
  receivingDomain: string,
  now: () => Date = () => new Date(),
) {
  const domain = emailIntakeReceivingDomainSchema.parse(receivingDomain);
  return {
    async createBinding(
      actor: Omit<EmailIntakeScope, "conversationId">,
      raw: EmailIntakeBindingRequest,
    ) {
      const input = emailIntakeBindingRequestSchema.parse(raw),
        scope = { ...actor, conversationId: input.conversationId };
      scopeSchema.parse(scope);
      const db = await database.getDb();
      const result = await atomic(db, async (session) => {
        if (!(await authorized(db, scope, session))) throw unavailable();
        const bindings = db.collection<Binding>("emailIntakeBindings");
        const old = await bindings.findOne(
          { _id: input.id },
          { session, maxTimeMS: 2000 },
        );
        if (old) {
          if (
            old.storeId !== scope.storeId ||
            old.ownerId !== scope.ownerId ||
            old.conversationId !== scope.conversationId ||
            old.allowedSender !== input.allowedSender
          )
            throw conflict();
          return bindingDto(old); // An idempotent retry never reactivates a revoked address.
        }
        if (
          await bindings.findOne(
            { ...scope, revokedAt: null },
            { session, maxTimeMS: 2000 },
          )
        )
          throw conflict();
        const binding: Binding = {
          ...scope,
          _id: input.id,
          allowedSender: input.allowedSender,
          recipient: `fl-${randomBytes(24).toString("hex")}@${domain}`,
          createdAt: now(),
          revokedAt: null,
        };
        await bindings.insertOne(binding, { session });
        return bindingDto(binding);
      });
      if (!(await authorized(db, scope))) throw unavailable();
      return result;
    },
    async revokeBinding(scope: EmailIntakeScope, id: string) {
      scopeSchema.parse(scope);
      z.uuid().parse(id);
      const db = await database.getDb();
      await atomic(db, async (session) => {
        if (!(await authorized(db, scope, session))) throw unavailable();
        const result = await db
          .collection<Binding>("emailIntakeBindings")
          .findOneAndUpdate(
            { _id: id, ...scope, revokedAt: null },
            { $set: { revokedAt: now() } },
            { session, returnDocument: "after" },
          );
        if (
          !result &&
          !(await db
            .collection<Binding>("emailIntakeBindings")
            .findOne({ _id: id, ...scope }, { session, maxTimeMS: 2000 }))
        )
          throw unavailable();
      });
    },
    async admit(input: VerifiedEvent): Promise<string | null> {
      // Only the signature-verified route calls this service, never model arguments/email prose.
      const db = await database.getDb(),
        digest = metadataHash(input);
      return atomic(db, async (session) => {
        const events = db.collection<Event>("emailIntakeEvents"),
          receipts = db.collection<Receipt>("emailIntakeReceipts");
        const oldEvent = await events.findOne(
          { _id: input.eventId },
          { session, maxTimeMS: 2000 },
        );
        const quarantine = async (id: string | null) => {
          if (id)
            await receipts.updateOne(
              { _id: id, status: { $ne: "QUARANTINED" } },
              {
                $set: { status: "QUARANTINED", updatedAt: now() },
                $inc: { version: 1 },
              },
              { session },
            );
        };
        if (oldEvent) {
          if (
            oldEvent.providerEmailId !== input.event.data.email_id ||
            oldEvent.metadataHash !== digest
          ) {
            await quarantine(oldEvent.receiptId);
            await events.updateOne(
              { _id: oldEvent._id },
              { $set: { result: "QUARANTINED" } },
              { session },
            );
          }
          return oldEvent.receiptId;
        }
        const ledger: Event = {
          _id: input.eventId,
          providerEmailId: input.event.data.email_id,
          metadataHash: digest,
          payloadHash: input.payloadHash,
          receiptId: null,
          result: "IGNORED_SCOPE",
          createdAt: now(),
        };
        const old = await receipts.findOne(
          { providerEmailId: input.event.data.email_id },
          { session, maxTimeMS: 2000 },
        );
        if (old) {
          ledger.receiptId = old._id;
          ledger.result =
            old.metadataHash === digest ? "DUPLICATE" : "QUARANTINED";
          if (ledger.result === "QUARANTINED") await quarantine(old._id);
          await events.insertOne(ledger, { session });
          return old._id;
        }
        const data = input.event.data;
        const recipients = [
          ...new Set(
            [...data.to, ...data.bcc, ...data.received_for]
              .map(declaredMailbox)
              .filter((v): v is string => v !== null),
          ),
        ];
        const candidates = await db
          .collection<Binding>("emailIntakeBindings")
          .find(
            { recipient: { $in: recipients }, revokedAt: null },
            { session },
          )
          .maxTimeMS(2000)
          .limit(2)
          .toArray();
        const binding = chooseInboundBinding(input.event, candidates);
        if (
          binding &&
          (await authorized(
            db,
            {
              storeId: binding.storeId,
              ownerId: binding.ownerId,
              conversationId: binding.conversationId,
            },
            session,
          ))
        ) {
          if (!data.attachments.length) ledger.result = "IGNORED_EMPTY";
          else {
            const timestamp = now();
            const receipt: Receipt = {
              _id: randomUUID(),
              storeId: binding.storeId,
              ownerId: binding.ownerId,
              conversationId: binding.conversationId,
              bindingId: binding._id,
              providerEmailId: data.email_id,
              metadataHash: digest,
              sender: binding.allowedSender,
              subject: data.subject,
              createdAt: timestamp,
              receivedAt: new Date(input.event.created_at),
              updatedAt: timestamp,
              version: 1,
              status: "AWAITING_CONFIRMATION",
              files: data.attachments.map((a) => ({
                id: randomUUID(),
                providerAttachmentId: a.id,
                filename: a.filename,
                mediaType: a.content_type,
                status: "PENDING",
                sourceDocumentId: null,
              })),
            };
            receiptDto(receipt);
            await receipts.insertOne(receipt, { session });
            await db
              .collection<{ _id: string }>("emailIntakeOriginalJobs")
              .insertMany(
                receipt.files.map((file) => ({
                  _id: file.id,
                  receiptId: receipt._id,
                  storeId: receipt.storeId,
                  ownerId: receipt.ownerId,
                  conversationId: receipt.conversationId,
                  bindingId: receipt.bindingId,
                  status: "PENDING",
                  attempts: 0,
                  nextAttemptAt: timestamp,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                })),
                { session },
              );
            ledger.receiptId = receipt._id;
            ledger.result = "ADMITTED";
          }
        }
        await events.insertOne(ledger, { session });
        return ledger.receiptId;
      });
    },
    async list(scope: EmailIntakeScope, cursor?: string) {
      scopeSchema.parse(scope);
      const db = await database.getDb();
      if (!(await authorized(db, scope))) throw unavailable();
      let boundary: z.infer<typeof cursorSchema> | undefined;
      if (cursor) {
        try {
          if (cursor.length > 1024) throw Error();
          boundary = cursorSchema.parse(
            JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
          );
          if (
            boundary.storeId !== scope.storeId ||
            boundary.ownerId !== scope.ownerId ||
            boundary.conversationId !== scope.conversationId
          )
            throw Error();
        } catch {
          throw new AuthError(
            400,
            "EMAIL_INTAKE_CURSOR_INVALID",
            "Relisez les documents depuis le début de la liste.",
          );
        }
      }
      const rows = await db
        .collection<Receipt>("emailIntakeReceipts")
        .find({
          ...scope,
          ...(boundary
            ? {
                $or: [
                  { createdAt: { $lt: new Date(boundary.createdAt) } },
                  {
                    createdAt: new Date(boundary.createdAt),
                    _id: { $lt: boundary.id },
                  },
                ],
              }
            : {}),
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(21)
        .maxTimeMS(2000)
        .toArray();
      const bindings = await db
        .collection<Binding>("emailIntakeBindings")
        .find(scope)
        .sort({ createdAt: -1, _id: -1 })
        .limit(50)
        .maxTimeMS(2000)
        .toArray();
      if (!(await authorized(db, scope))) throw unavailable();
      const visible = rows.slice(0, 20),
        last = visible.at(-1);
      return emailIntakeListSchema.parse({
        bindings: bindings.map(bindingDto),
        receipts: visible.map(receiptDto),
        nextCursor:
          rows.length > 20 && last
            ? Buffer.from(
                JSON.stringify({
                  ...scope,
                  createdAt: last.createdAt.toISOString(),
                  id: last._id,
                }),
              ).toString("base64url")
            : null,
      });
    },
  };
}
export type EmailIntakeStore = ReturnType<typeof createEmailIntakeStore>;
export type {
  Receipt as EmailIntakeReceiptRecord,
  Binding as EmailIntakeBindingRecord,
};
export { authorized as emailIntakeAuthorized, atomic as emailIntakeAtomic };
