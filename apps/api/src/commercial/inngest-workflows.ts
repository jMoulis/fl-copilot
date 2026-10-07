import { createCommercialAiDraftProcessor } from "./ai-draft-processing.js";
import type { CommercialAiProvider } from "./ai-provider.js";
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
  aiProvider?: CommercialAiProvider,
) {
  const client = new Inngest({
    id: "fl-copilot-api",
    eventKey,
    signingKey,
    isDev: false,
  });
  const processor = createCommercialPdfPageProcessor(database);
  const aiProcessor = aiProvider
    ? createCommercialAiDraftProcessor(database, aiProvider)
    : undefined;
  const aiPage = aiProcessor
    ? client.createFunction(
        {
          id: "commercial-pdf-ai-page-v1",
          concurrency: 2,
          retries: 3,
          triggers: [{ event: "commercial/pdf.ai-page" }],
        },
        async ({ event, step }) => {
          const identity = sourceIdentity
            .extend({ pageNumber: z.number().int().min(1).max(100) })
            .parse(event.data);
          return step.run("extract-page-draft", () =>
            aiProcessor.extractPage(
              identity.storeId,
              identity.sourceDocumentId,
              identity.pageNumber,
            ),
          );
        },
      )
    : undefined;
  const aiDocument =
    aiProcessor && aiPage
      ? client.createFunction(
          {
            id: "commercial-pdf-ai-document-v1",
            concurrency: 2,
            retries: 3,
            triggers: [{ event: "commercial/pdf.text-ready" }],
          },
          async ({ event, step }) => {
            const identity = sourceIdentity.parse(event.data);
            const manifest = await step.run("source-page-manifest", () =>
              aiProcessor.manifest(identity.storeId, identity.sourceDocumentId),
            );
            if (manifest.status !== "READY") return { status: manifest.status };
            await Promise.all(
              manifest.pages.map((pageNumber) =>
                step.invoke(`draft-page-${pageNumber}`, {
                  function: aiPage,
                  data: { ...identity, pageNumber },
                }),
              ),
            );
            return step.run("finalize-unvalidated-draft", () =>
              aiProcessor.finalize(identity.storeId, identity.sourceDocumentId),
            );
          },
        )
      : undefined;
  const extract = client.createFunction(
    {
      id: "commercial-pdf-extract-pages-v1",
      concurrency: 2,
      retries: 3,
      triggers: [{ event: "commercial/pdf.uploaded" }],
    },
    async ({ event, step }) => {
      const identity = sourceIdentity.parse(event.data);
      const result = await step.run("extract-source-pages", () =>
        processor.process(identity.storeId, identity.sourceDocumentId),
      );
      if (result.status === "TEXT_READY" && aiDocument)
        await step.sendEvent("request-commercial-draft", {
          id: `commercial-pdf.ai.v1:${identity.sourceDocumentId}`,
          name: "commercial/pdf.text-ready",
          data: identity,
        });
      return result;
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
      const aiPending =
        aiProcessor && aiDocument
          ? await step.run("pending-ai-sources", () =>
              aiProcessor.pendingDocuments(),
            )
          : [];
      if (aiDocument)
        for (const source of aiPending)
          await step.invoke(`recover-ai-${source.sourceDocumentId}`, {
            function: aiDocument,
            data: source,
          });
      return { scheduled: pending.length, aiScheduled: aiPending.length };
    },
  );
  return {
    client,
    functions: [
      extract,
      recover,
      ...(aiDocument && aiPage ? [aiDocument, aiPage] : []),
    ],
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
