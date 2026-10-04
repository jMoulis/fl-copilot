import { describe, expect, it } from "vitest";
import {
  getVercelOidcToken,
  runWithVercelOidcToken,
} from "../src/vercel-request-context.js";

describe("Vercel request context", () => {
  it("keeps the OIDC token available across asynchronous request work", async () => {
    expect(getVercelOidcToken()).toBeUndefined();

    await runWithVercelOidcToken("request-oidc-token", async () => {
      await Promise.resolve();
      expect(getVercelOidcToken()).toBe("request-oidc-token");
    });

    expect(getVercelOidcToken()).toBeUndefined();
  });
});
