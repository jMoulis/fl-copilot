import { randomUUID } from "node:crypto";
import { layoutScenarioFixture } from "./test-layout-scenario-fixtures";
import { completeLayoutGeometry } from "./test-store-layout-fixtures";
import { prepareStoreLayoutScenario } from "../packages/commercial-core/src/store-layout-scenario";
import { buildStoreLayoutScenarioMessages } from "../apps/api/src/copilot/store-layout-scenario-messages";
import { presentStoreLayoutScenario } from "../apps/api/src/copilot/store-layout-scenario-tool";
import { copilotMessageSchema } from "../packages/domain/src/copilot-conversation";
/** Synthetic declared geometry only, never an actual pilot survey or runtime fallback. */
export async function illustrationFixture(complete = true) {
  const f = await layoutScenarioFixture();
  if (complete) {
    const c = completeLayoutGeometry();
    // Keep existing fixture identities, surfaces and source membership.
    f.reference.content.room = c.room;
    f.reference.content.assemblies.forEach((a, i) => {
      const source = c.assemblies[i]!;
      Object.assign(a, {
        x: source.x,
        y: source.y,
        dimensions: source.dimensions,
      });
    });
    f.reference.content.furniture.forEach((a, i) => {
      const source = c.furniture[i]!;
      Object.assign(a, {
        x: source.x,
        y: source.y,
        rotation: source.rotation,
        dimensions: source.dimensions,
      });
    });
  }
  const scenario = prepareStoreLayoutScenario(
    f.reference.storeId,
    f.input,
    f.sources,
  ).scenario!;
  const scope = {
    storeId: f.reference.storeId,
    ownerId: randomUUID(),
    conversationId: randomUUID(),
  };
  const assistant = copilotMessageSchema.parse({
    ...scope,
    id: randomUUID(),
    role: "ASSISTANT",
    text: "Proposition",
    attachments: [],
    replyToMessageId: randomUUID(),
    supersedesMessageId: null,
    version: 1,
    createdAt: "2026-10-20T16:00:00.000Z",
  });
  const [card] = buildStoreLayoutScenarioMessages(assistant, [
    presentStoreLayoutScenario(scope.storeId, f.input, f.sources),
  ]);
  return { ...f, scenario, scope, card: card! };
}
