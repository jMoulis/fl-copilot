import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MercalysTestDatabase } from "../../../../scripts/test-mercalys-sync-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { runLocalMigrations } from "../db/migrations";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "./conversation-repository";
import { CopilotKnowledgeRepository } from "./knowledge-repository";
import {
  loadKnowledgeSuggestion,
  confirmKnowledgeSuggestion,
} from "./knowledge-suggestion";
import { buildKnowledgeSuggestionMessages } from "../../../api/src/copilot/knowledge-suggestion-messages";
const now = "2026-10-15T12:00:00.000Z";
async function fixture() {
  const db = new MercalysTestDatabase();
  await runLocalMigrations(db);
  const f = chatFixture(randomUUID),
    scope = { storeId: f.storeId, ownerId: f.ownerId };
  const repo = new CopilotConversationRepository(db, scope);
  await repo.save(f.conversation, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  const source = {
    ...f.message,
    text: "La casse est scannée chaque jour et saisie par regroupements.",
    attachments: [],
  };
  await repo.append(source, { commandId: randomUUID(), deviceId: f.deviceId });
  const assistant = {
    ...source,
    id: randomUUID(),
    role: "ASSISTANT" as const,
    replyToMessageId: source.id,
    text: "Je peux proposer de retenir cette pratique.",
  };
  const request = {
    memorySuggestion: { currentUserMessageId: source.id },
    userQuestion: source.text,
  };
  const proposal = buildKnowledgeSuggestionMessages(
    assistant,
    [
      {
        statement: source.text,
        sources: [{ messageId: source.id, quote: source.text }],
      },
    ],
    request as Parameters<typeof buildKnowledgeSuggestionMessages>[2],
  )[0]!;
  await applyCopilotRecord(db, scope, "copilot_message", assistant);
  await applyCopilotRecord(db, scope, "copilot_message", proposal);
  return { db, f, scope, repo, source, proposal };
}
it("does not memorize on preparation/open, confirms edited text once offline, and never revives a forgotten proposal", async () => {
  const f = await fixture();
  try {
    const repo = new CopilotKnowledgeRepository(f.db, f.scope);
    await loadKnowledgeSuggestion(f.db, f.scope, f.proposal.id);
    expect(await repo.list()).toEqual([]);
    const ctx = () => ({
      commandId: randomUUID(),
      deviceId: f.f.deviceId,
      now,
    });
    const result = await confirmKnowledgeSuggestion(
      f.db,
      f.scope,
      f.proposal.id,
      "La casse est comptabilisée à la date de saisie.",
      ctx(),
    );
    expect(result.alreadyApplied).toBe(false);
    expect(result.entity.statement).toContain("date de saisie");
    expect(
      (
        await confirmKnowledgeSuggestion(
          f.db,
          f.scope,
          f.proposal.id,
          "Autre texte",
          ctx(),
        )
      ).alreadyApplied,
    ).toBe(true);
    expect(
      await f.db.getFirstAsync(
        "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='copilot_knowledge'",
      ),
    ).toEqual({ n: 1 });
    await repo.save(
      {
        ...result.entity,
        statement: "Oublié",
        status: "FORGOTTEN",
        version: 2,
      },
      ctx(),
    );
    expect(
      (
        await confirmKnowledgeSuggestion(
          f.db,
          f.scope,
          f.proposal.id,
          "Réactiver",
          ctx(),
        )
      ).entity.status,
    ).toBe("FORGOTTEN");
  } finally {
    f.db.db.close();
  }
});
it("rejects a foreign account and an obsolete source before any memory write", async () => {
  const f = await fixture();
  try {
    await expect(
      loadKnowledgeSuggestion(
        f.db,
        { ...f.scope, ownerId: randomUUID() },
        f.proposal.id,
      ),
    ).rejects.toThrow();
    await f.repo.append(
      {
        ...f.source,
        id: randomUUID(),
        text: "Correction de la pratique",
        supersedesMessageId: f.source.id,
      },
      { commandId: randomUUID(), deviceId: f.f.deviceId },
    );
    await expect(
      confirmKnowledgeSuggestion(
        f.db,
        f.scope,
        f.proposal.id,
        "Texte proposé",
        { commandId: randomUUID(), deviceId: f.f.deviceId, now },
      ),
    ).rejects.toThrow("SUPERSEDED");
    expect(await new CopilotKnowledgeRepository(f.db, f.scope).list()).toEqual(
      [],
    );
  } finally {
    f.db.db.close();
  }
});
