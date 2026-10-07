import { Inngest } from "inngest";
import { z } from "zod";
import type { DatabaseService } from "../database/types.js";
import { createCommercialPdfPageProcessor } from "./pdf-page-processing.js";
const sourceIdentity = z.object({
  storeId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
});
export function createCommercialInngestWorkflows(
  database: DatabaseService,
  eventKey: string,
  signingKey: string,
) {
  const client = new Inngest({
    id: "fl-copilot-api",
    eventKey,
    signingKey,
    isDev: false,
  });
  const processor = createCommercialPdfPageProcessor(database);
  const extract = client.createFunction(
    {
      id: "commercial-pdf-extract-pages-v1",
      concurrency: 2,
      retries: 3,
      triggers: [{ event: "commercial/pdf.uploaded" }],
    },
    async ({ event, step }) => {
      const identity = sourceIdentity.parse(event.data);
      return step.run("extract-source-pages", () =>
        processor.process(identity.storeId, identity.sourceDocumentId),
      );
    },
  );
  const recover = client.createFunction(
    {
      id: "commercial-pdf-recover-pending-v1",
      concurrency: 1,
      retries: 3,
      triggers: [{ cron: "*/5 * * * *" }],
    },
    async ({ step }) => {
      const pending = await step.run("pending-sources", () =>
        processor.pending(),
      );
      for (const source of pending)
        await step.invoke(`recover-${source.sourceDocumentId}`, {
          function: extract,
          data: source,
        });
      return { scheduled: pending.length };
    },
  );
  return {
    client,
    functions: [extract, recover],
    async dispatch(storeId: string, sourceDocumentId: string) {
      sourceIdentity.parse({ storeId, sourceDocumentId });
      await client.send({
        id: `commercial-pdf.pages.v1:${sourceDocumentId}`,
        name: "commercial/pdf.uploaded",
        data: { storeId, sourceDocumentId },
      });
    },
  };
}
