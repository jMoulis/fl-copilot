import { randomUUID, createHash } from "node:crypto";
import { makeCommercialChoiceFixture } from "./commercial-choice-fixture-data";
export const testChoiceDigest = async (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function commercialChoiceFixture(
  input: Partial<{
    storeId: string;
    readingId: string;
    sourceDocumentId: string;
    productId: string;
  }> = {},
) {
  return makeCommercialChoiceFixture(input, testChoiceDigest, randomUUID);
}
