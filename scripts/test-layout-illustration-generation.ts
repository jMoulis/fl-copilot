import { randomUUID } from "node:crypto";
import { illustrationAssetsFixture } from "./test-layout-illustration-assets";
import {
  layoutIllustrationQuoteSchema,
  layoutIllustrationGenerationPolicySchema,
} from "../packages/domain/src/index";
export async function illustrationGenerationFixture(path = ":memory:") {
  const f = await illustrationAssetsFixture(path);
  const policy = layoutIllustrationGenerationPolicySchema.parse({
    id: randomUUID(),
    textModel: "synthetic-text",
    imageModel: "synthetic-image",
    estimatedCostUsdMicros: 500_000,
    storeDailyAttempts: 3,
    ownerDailyAttempts: 3,
    globalDailyAttempts: 6,
    storeDailyReservedUsdMicros: 1_500_000,
    globalDailyReservedUsdMicros: 3_000_000,
  });
  const quote = layoutIllustrationQuoteSchema.parse({
    body: {
      id: randomUUID(),
      preparation: f.preparation,
      policy,
      format: "PNG_1536x1024_LOW_ONE",
      issuedAt: "2026-10-20T17:00:00.000Z",
      expiresAt: "2026-10-20T17:05:00.000Z",
    },
    signature: "a".repeat(64),
  });
  const ids = { id: randomUUID(), deviceId: f.ids.deviceId };
  return { ...f, policy, quote, ids, now: () => "2026-10-20T17:00:10.000Z" };
}
