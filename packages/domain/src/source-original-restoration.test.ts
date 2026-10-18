import { expect, it } from "vitest";
import { sourceOriginalRestorationSchema } from "./source-original-restoration";
it("accepts only a bounded device copy proof and no model-granted scope or remote URL", () => {
  const proof = {
    operationId: "11111111-1111-4111-8111-111111111111",
    basisHash: "a".repeat(64),
    copy: {
      localUri: "file:///private/recovered.pdf",
      checksum: `sha256:${"a".repeat(64)}`,
      sizeBytes: 100,
      mimeType: "application/pdf",
    },
  };
  expect(sourceOriginalRestorationSchema.safeParse(proof).success).toBe(true);
  expect(
    sourceOriginalRestorationSchema.safeParse({
      ...proof,
      copy: { ...proof.copy, localUri: "file:///bad" + String.fromCharCode(0) },
    }).success,
  ).toBe(false);
  expect(
    sourceOriginalRestorationSchema.safeParse({ ...proof, canRestore: true })
      .success,
  ).toBe(false);
  expect(
    sourceOriginalRestorationSchema.safeParse({
      ...proof,
      copy: { ...proof.copy, localUri: "https://untrusted.example/file" },
    }).success,
  ).toBe(false);
  expect(
    sourceOriginalRestorationSchema.safeParse({
      ...proof,
      copy: { ...proof.copy, sizeBytes: 101 * 1024 * 1024 },
    }).success,
  ).toBe(false);
});
