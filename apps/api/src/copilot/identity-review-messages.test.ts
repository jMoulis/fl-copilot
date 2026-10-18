import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { identityFixture } from "../../../../scripts/test-identity-review-fixtures";
import {
  identityReviewInputSchema,
  readIdentityReviewProposal,
} from "@fl-copilot/domain";
import { buildIdentityReviewMessages } from "./identity-review-messages";
it("has no model authority, rename, creation or identifier refusal path", () => {
  const f = identityFixture();
  for (const extra of [
    { storeId: randomUUID() },
    { reactivateRejectedAlias: true },
    { expectedVersion: 3 },
    { alias: "Other" },
  ])
    expect(
      identityReviewInputSchema.safeParse({ ...f.input, ...extra }).success,
    ).toBe(false);
  expect(
    identityReviewInputSchema.safeParse({
      ...f.input,
      kind: "IDENTIFIER",
      decision: "REJECT",
    }).success,
  ).toBe(false);
});
it("keeps the latest decision per entry, emits no unchanged card, and binds deterministic private identity", () => {
  const f = identityFixture(),
    ready = buildIdentityReviewMessages(f.assistant, [f.preview, f.preview]);
  expect(ready).toHaveLength(1);
  expect(buildIdentityReviewMessages(f.assistant, [f.preview])).toEqual(ready);
  expect(readIdentityReviewProposal(ready[0]).content.before.entry).toEqual(
    f.entry,
  );
  expect(
    buildIdentityReviewMessages(f.assistant, [
      f.preview,
      { ...f.preview, status: "AMBIGUOUS" },
    ]),
  ).toEqual([]);
  expect(
    buildIdentityReviewMessages(f.assistant, [
      { ...f.preview, status: "UNCHANGED" },
    ]),
  ).toEqual([]);
  expect(() =>
    buildIdentityReviewMessages({ ...f.assistant, storeId: randomUUID() }, [
      f.preview,
    ]),
  ).toThrow();
  expect(() =>
    readIdentityReviewProposal({ ...ready[0], role: "USER" }),
  ).toThrow();
});
it("rejects foreign/retargeted entries and bounds complete ready cards", () => {
  const f = identityFixture();
  const alter = (before: unknown) => ({ ...f.preview, before });
  expect(() =>
    buildIdentityReviewMessages(f.assistant, [
      alter({ ...f.before, entry: { ...f.entry, storeId: randomUUID() } }),
    ]),
  ).toThrow();
  expect(() =>
    buildIdentityReviewMessages(f.assistant, [
      alter({ ...f.before, entry: { ...f.entry, productId: randomUUID() } }),
    ]),
  ).toThrow();
  const many = Array.from({ length: 4 }, () => {
    const x = identityFixture();
    return {
      ...x.preview,
      before: {
        product: { ...x.product, storeId: f.chat.storeId },
        entry: { ...x.entry, storeId: f.chat.storeId },
      },
    };
  });
  expect(() => buildIdentityReviewMessages(f.assistant, many)).toThrow("LIMIT");
});
