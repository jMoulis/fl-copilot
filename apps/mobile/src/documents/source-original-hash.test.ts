import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { sourceOriginalHash } from "./source-original-hash";
it("matches the remote SHA-256 for original bytes and Unicode metadata", () => {
  for (const value of [
    "",
    "Pense-bête · récolte française 🍅",
    new Uint8Array([0, 1, 255, 128, 10]),
  ])
    expect(sourceOriginalHash(value)).toBe(
      `sha256:${createHash("sha256").update(value).digest("hex")}`,
    );
});
