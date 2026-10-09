import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
export type ProviderResult<T> = {
  data: T | null;
  retrievedAt: string | null;
  validUntil: string | null;
  failed: boolean;
};
type Cached = {
  url: string;
  data?: unknown;
  retrievedAt?: string;
  validUntil?: string;
  lastModified?: string;
  leaseId?: string;
  leaseUntil?: string;
};
export class ContextProviderCache {
  constructor(
    private db: Db,
    private fetcher: typeof fetch = fetch,
    private now: () => Date = () => new Date(),
  ) {}
  async read<T>(
    url: string,
    schema: z.ZodType<T>,
    ttl: number,
  ): Promise<ProviderResult<T>> {
    const collection = this.db.collection<Cached>("contextProviderCache"),
      at = this.now(),
      iso = at.toISOString();
    const cached = await collection.findOne({ url });
    const parsed = schema.safeParse(cached?.data);
    const previous = () => ({
      data: parsed.success ? parsed.data : null,
      retrievedAt: cached?.retrievedAt ?? null,
      validUntil: cached?.validUntil ?? null,
      failed: true,
    });
    if (parsed.success && cached?.validUntil && cached.validUntil > iso)
      return { ...previous(), failed: false };
    // A bounded lease prevents parallel devices from hammering a provider. Cache leases are not business writes.
    try {
      await collection.updateOne(
        { url },
        { $setOnInsert: { url } },
        { upsert: true },
      );
    } catch (e) {
      if (!(
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        e.code === 11000
      ))
        throw e;
    }
    const leaseId = randomUUID();
    const lease = await collection.updateOne(
      {
        url,
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lte: iso } },
        ],
      },
      {
        $set: {
          leaseId,
          leaseUntil: new Date(at.getTime() + 20000).toISOString(),
        },
      },
    );
    if (!lease.modifiedCount) return previous();
    try {
      const headers: Record<string, string> = {
        "User-Agent":
          "FruitsVegetablesCopilot/1.0 (https://github.com/jMoulis/fl-copilot)",
        Accept: "application/json",
      };
      if (parsed.success && cached?.lastModified)
        headers["If-Modified-Since"] = cached.lastModified;
      const r = await this.fetcher(url, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok && r.status !== 304) throw Error("CONTEXT_PROVIDER_HTTP");
      const data =
        r.status === 304 && parsed.success
          ? parsed.data
          : schema.parse(await r.json());
      const expiry = Date.parse(r.headers.get("expires") ?? "");
      // MET's Expires takes precedence; calendars/communes use a conservative daily TTL.
      const validUntil = new Date(
        Number.isFinite(expiry) && expiry > at.getTime()
          ? expiry
          : at.getTime() + ttl,
      ).toISOString();
      const retrievedAt = this.now().toISOString();
      await collection.updateOne(
        { url, leaseId },
        {
          $set: {
            data,
            retrievedAt,
            validUntil,
            lastModified:
              r.headers.get("last-modified") ?? cached?.lastModified,
          },
          $unset: { leaseId: "", leaseUntil: "" },
        },
      );
      return { data, retrievedAt, validUntil, failed: false };
    } catch {
      await collection.updateOne(
        { url, leaseId },
        {
          $set: { leaseUntil: new Date(at.getTime() + 60000).toISOString() },
          $unset: { leaseId: "" },
        },
      );
      return previous();
    }
  }
}
