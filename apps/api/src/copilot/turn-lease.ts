import { randomUUID } from "node:crypto";
import type { Db, ClientSession } from "mongodb";
export type TurnLeaseIdentity = {
  replyId: string;
  storeId: string;
  ownerId: string;
  conversationId: string;
  userMessageId: string;
};
type Lease = Omit<TurnLeaseIdentity, "replyId"> & {
  _id: string;
  token: string;
  expiresAt: Date;
  fenceVersion?: number;
};
export class CopilotTurnLeaseError extends Error {
  constructor(
    readonly code: "IN_PROGRESS" | "IDENTITY_CONFLICT" | "LEASE_EXPIRED",
  ) {
    super(code);
    this.name = "CopilotTurnLeaseError";
  }
}
export async function acquireTurnLease(db: Db, identity: TurnLeaseIdentity) {
  const { replyId, ...scope } = identity;
  const token = randomUUID(),
    now = new Date();
  const collection = db.collection<Lease>("copilotTurnLeases");
  try {
    const row = await collection.findOneAndUpdate(
      { _id: replyId, ...scope, expiresAt: { $lte: now } },
      {
        $set: { token, expiresAt: new Date(now.getTime() + 600_000) },
        $setOnInsert: scope,
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!row) throw new CopilotTurnLeaseError("IN_PROGRESS");
  } catch (error) {
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ))
      throw error;
    const row = await collection.findOne({ _id: replyId });
    if (
      !row ||
      Object.entries(scope).some(
        ([key, value]) => row[key as keyof Lease] !== value,
      )
    )
      throw new CopilotTurnLeaseError("IDENTITY_CONFLICT");
    throw new CopilotTurnLeaseError("IN_PROGRESS");
  }
  return {
    async fence(session: ClientSession) {
      // A write in the same transaction conflicts with a lease takeover, fencing stale workers.
      const result = await collection.updateOne(
        { _id: replyId, token, expiresAt: { $gt: new Date() } },
        { $inc: { fenceVersion: 1 } },
        { session },
      );
      if (result.matchedCount !== 1)
        throw new CopilotTurnLeaseError("LEASE_EXPIRED");
    },
    async release() {
      await collection.updateOne(
        { _id: replyId, token },
        { $set: { expiresAt: new Date(0) } },
      );
    },
  };
}
