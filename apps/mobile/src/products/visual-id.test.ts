import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { visualIdMaterial, visualIdFromDigest } from "@fl-copilot/domain";
import { nativeVisualId } from "./visual-id";
import { digestVisualId as expoDigest } from "./visual-id-digest.native";

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: vi.fn(async (algorithm: string, material: string) => {
    expect(algorithm).toBe("SHA-256");
    return createHash("sha256").update(material, "utf8").digest("hex");
  }),
}));
it("agrees between WebCrypto, native Expo's SHA-256 port and the server UUID convention", async () => {
  const store = "11111111-1111-4111-8111-111111111111";
  for (const [kind, key, expected] of [
    [
      "visual_asset",
      `sha256:${"a".repeat(64)}`,
      "c8f7d765-9a0e-8a6c-bfa7-772d9500b4ba",
    ],
    [
      "product_visual_link",
      "22222222-2222-4222-8222-222222222222",
      "fcf87a3f-81a0-8391-9537-8c56dfec4f72",
    ],
  ] as const) {
    expect(await nativeVisualId(kind, store, key)).toBe(expected);
    expect(
      visualIdFromDigest(await expoDigest(visualIdMaterial(kind, store, key))),
    ).toBe(expected);
  }
});
