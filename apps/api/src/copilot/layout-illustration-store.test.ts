import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { expect, it } from "vitest";
import { layoutIllustrationPreparationSchema } from "@fl-copilot/domain";
import { illustrationPreparationFixture } from "../../../../scripts/test-layout-illustration-preparations";
import { canAccessLayoutIllustration } from "./layout-illustration-store";
it("does not convert a temporary database failure into a permanent access rejection", async () => {
  const f = await illustrationPreparationFixture();
  try {
    const e = await f.repo.prepare(f.card, f.ids);
    const db = {
      collection() {
        throw Error("DATABASE_TEMPORARILY_UNAVAILABLE");
      },
    } as unknown as Db;
    await expect(
      canAccessLayoutIllustration(db, e.storeId, e.ownerId, {
        commandId: randomUUID(),
        entityId: e.id,
        entityType: "copilot_layout_illustration",
        type: "COPILOT_LAYOUT_ILLUSTRATION_PREPARE",
        localSequence: 1,
        createdAt: e.createdAt,
        payload: e,
      }),
    ).rejects.toThrow("DATABASE_TEMPORARILY_UNAVAILABLE");
  } finally {
    f.db.close();
  }
});
it("cannot turn an unpaid preparation into generated data, billing approval or a different immutable version", async () => {
  const f = await illustrationPreparationFixture();
  try {
    const e = await f.repo.prepare(f.card, f.ids);
    for (const patch of [
      { intent: "GENERATE" },
      { status: "READY" },
      { version: 2 },
      { apiKey: "not-real" },
      { image: "base64" },
      { budgetApproved: true },
    ])
      expect(
        layoutIllustrationPreparationSchema.safeParse({ ...e, ...patch })
          .success,
      ).toBe(false);
  } finally {
    f.db.close();
  }
});
