import { randomUUID } from "node:crypto";
import {
  decisionFixture,
  decisionNativeFixture,
  decisionDigest,
} from "./test-copilot-decision-fixtures";
import { MercalysTestDatabase } from "./test-mercalys-sync-fixtures";
import {
  copilotMessageSchema,
  actionExecutionPreviewSchema,
} from "../packages/domain/src/index";
import { buildActionExecutionMessages } from "../apps/api/src/copilot/action-execution-messages";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { CopilotActionExecutionRepository } from "../apps/mobile/src/copilot/action-execution-repository";
export async function actionExecutionFixture(db = new MercalysTestDatabase()) {
  const n = await decisionNativeFixture(decisionFixture(), db),
    input = {
      sourceMessageId: n.source.id,
      quote: n.preview.input.quote,
      action: "J’ai déplacé les tomates près de l’entrée.",
      actuals: {
        start: "2026-10-16",
        end: null,
        price: null,
        priceUnit: null,
        location: "Îlot entrée",
      },
      notes: "Observation terrain",
    };
  const preview = actionExecutionPreviewSchema.parse({
    input,
    status: "READY",
    snapshot: {
      basis: n.preview.basis,
      action: input.action,
      actuals: input.actuals,
      notes: input.notes,
    },
    evidence: n.preview.evidence,
  });
  const request = copilotMessageSchema.parse({
    ...n.request,
    id: randomUUID(),
    createdAt: "2026-10-18T12:00:01.000Z",
    text: "J’ai fait cette action, note-la.",
  });
  const assistant = copilotMessageSchema.parse({
    ...n.assistant,
    id: randomUUID(),
    replyToMessageId: request.id,
    createdAt: "2026-10-18T12:00:02.000Z",
    text: "Déclaration préparée, à confirmer.",
  });
  const card = buildActionExecutionMessages(assistant, [preview])[0]!;
  for (const m of [request, assistant, card])
    await applyCopilotRecord(db, n.scope, "copilot_message", m);
  const scope = { ...n.scope, canRecord: true };
  const repository = new CopilotActionExecutionRepository(
    db,
    scope,
    decisionDigest,
    randomUUID,
    () => "2026-10-18T12:00:10.000Z",
  );
  return {
    ...n,
    input,
    preview,
    actionRequest: request,
    actionAssistant: assistant,
    actionCard: card,
    repository,
    actionScope: scope,
  };
}
