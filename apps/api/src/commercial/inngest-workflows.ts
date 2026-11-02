import { advanceProductUnitRefresh } from "../analytics/product-unit-refresh";
import type { LayoutIllustrationGenerationService } from "../copilot/layout-illustration-generation";
import { createCommercialProcessingRecovery } from "./processing-recovery.js";
import type { EmailOriginalProcessor } from "../intake/email-originals.js";
import { createSubstitutionEvidenceProcessor } from "../substitution/processor.js";
import { createCommercialVisualProcessor } from "./visual-processing.js";
import type { CommercialVisualProvider } from "./visual-provider.js";
import { Inngest } from "inngest";
import { z } from "zod";
import type { DatabaseService } from "../database/types.js";
import { createCommercialPdfPageProcessor } from "./pdf-page-processing.js";
const sourceIdentity = z.object({
  storeId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
});
/** Workflow storage receives only progress identity, never quote signatures, prompts or image bytes. */
export async function illustrationGenerationStage(
  service: Pick<LayoutIllustrationGenerationService, "process">,
  id: string,
) {
  const r = await service.process(id);
  return { id: r.id, status: r.status, recoverAt: r.recoverAt };
}
export function createCommercialInngestWorkflows(
  database: DatabaseService,
  eventKey: string,
  signingKey: string,
  visualProvider?: CommercialVisualProvider,
  emailOriginals?: EmailOriginalProcessor,
  illustrations?: Pick<
    LayoutIllustrationGenerationService,
    "process" | "pending"
  >,
) {
  const client = new Inngest({
    id: "fl-copilot-api",
    eventKey,
    signingKey,
    isDev: false,
  });
  const illustration = illustrations
    ? client.createFunction(
        {
          id: "layout-illustration-one-v1",
          concurrency: 1,
          retries: 3,
          triggers: [{ event: "copilot/layout-illustration.generate" }],
        },
        async ({ event, step }) => {
          const { id } = z.strictObject({ id: z.uuid() }).parse(event.data);
          const first = await step.run(
            "generate-once-and-conserve-original",
            () => illustrationGenerationStage(illustrations, id),
          );
          if (first.status !== "SUBMITTED")
            return { id: first.id, status: first.status };
          await step.sleepUntil("wait-for-submitted-attempt", first.recoverAt!);
          const recovered = await step.run("recover-same-original-only", () =>
            illustrationGenerationStage(illustrations, id),
          );
          return { id: recovered.id, status: recovered.status };
        },
      )
    : undefined;
  async function dispatchIllustrations(storeId?: string) {
    const pending = illustrations ? await illustrations.pending(storeId) : [];
    if (pending.length)
      await client.send(
        pending.map((job) => ({
          id: `layout-illustration.v1:${job.id}:${job.version}`,
          name: "copilot/layout-illustration.generate",
          data: { id: job.id },
        })),
      );
    return pending.length;
  }
  const emailOriginal = emailOriginals
    ? client.createFunction(
        {
          id: "email-preserve-original-v1",
          concurrency: 2,
          retries: 3,
          triggers: [{ event: "email/original.preserve" }],
        },
        async ({ event, step }) => {
          const input = z.strictObject({ jobId: z.uuid() }).parse(event.data);
          return step.run("preserve-private-original", () =>
            emailOriginals.preserve(input.jobId),
          );
        },
      )
    : undefined;
  async function dispatchEmailOriginals(receiptId?: string) {
    const pending = emailOriginals
      ? await emailOriginals.pending(receiptId)
      : [];
    if (pending.length)
      await client.send(
        pending.map((job) => ({
          id: `email-original.v1:${job.jobId}:${job.generation}`,
          name: "email/original.preserve",
          data: { jobId: job.jobId },
        })),
      );
    return pending.length;
  }
  const recovery = createCommercialProcessingRecovery(
    database,
    {
      enabled: !!visualProvider,
      model: visualProvider?.model ?? "unavailable",
    },
    async (input) => {
      await client.send({
        id: `commercial-pdf.resume.v1:${input.operationId}`,
        name: "commercial/pdf.resume",
        data: input,
      });
    },
  );
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
  const visualProcessor = visualProvider
    ? createCommercialVisualProcessor(database, visualProvider)
    : undefined;
  const visualPage = visualProcessor
    ? client.createFunction(
        {
          id: "commercial-pdf-visual-page-v1",
          concurrency: 2,
          retries: 3,
          triggers: [{ event: "commercial/pdf.visual-page" }],
        },
        async ({ event, step }) => {
          const identity = sourceIdentity
            .extend({ pageNumber: z.number().int().min(1).max(100) })
            .parse(event.data);
          return step.run("read-original-pdf", () =>
            visualProcessor.process(
              identity.storeId,
              identity.sourceDocumentId,
              identity.pageNumber,
            ),
          );
        },
      )
    : undefined;
  const resume = client.createFunction(
    {
      id: "commercial-pdf-resume-v1",
      concurrency: 2,
      retries: 3,
      triggers: [{ event: "commercial/pdf.resume" }],
    },
    async ({ event, step }) => {
      const identity = sourceIdentity
        .extend({ operationId: z.uuid() })
        .parse(event.data);
      const work = await step.run("review-resume-request", () =>
        recovery.work(
          identity.storeId,
          identity.sourceDocumentId,
          identity.operationId,
        ),
      );
      if (work.includes("TEXT"))
        await step.invoke("resume-pdf-pages", {
          function: extract,
          data: {
            storeId: identity.storeId,
            sourceDocumentId: identity.sourceDocumentId,
          },
        });
      if (work.includes("VISUAL") && visualProcessor && visualPage) {
        const pending = await step.run("resume-visual-manifest", () =>
          visualProcessor.pending({
            storeId: identity.storeId,
            sourceDocumentId: identity.sourceDocumentId,
          }),
        );
        for (const source of pending)
          await Promise.all(
            source.pages.map((pageNumber) =>
              step.invoke(`resume-visual-${pageNumber}`, {
                function: visualPage,
                data: {
                  storeId: identity.storeId,
                  sourceDocumentId: identity.sourceDocumentId,
                  pageNumber,
                },
              }),
            ),
          );
      }
      return { scheduledStages: work };
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
      // Reuse the existing recovery cadence; sync also advances this work when workflow quota is unavailable.
      for (let page = 0; page < 4; page += 1) {
        const refreshed = await step.run(`refresh-product-units-${page}`, () =>
          advanceProductUnitRefresh(database),
        );
        if (!refreshed.processed) break;
      }
      if (emailOriginals)
        await step.run("recover-email-originals", () =>
          dispatchEmailOriginals(),
        );
      await step.run("dispatch-document-recovery-requests", () =>
        recovery.pendingDispatches(),
      );
      const pending = await step.run("pending-sources", () =>
        processor.pending(),
      );
      for (const source of pending)
        await step.invoke(`recover-${source.sourceDocumentId}`, {
          function: extract,
          data: source,
        });
      const visualPending = visualProcessor
        ? await step.run("pending-visual-sources", () =>
            visualProcessor.pending(),
          )
        : [];
      if (visualPage)
        for (const source of visualPending)
          await Promise.all(
            source.pages.map((pageNumber) =>
              step.invoke(`visual-${source.sourceDocumentId}-${pageNumber}`, {
                function: visualPage,
                data: {
                  storeId: source.storeId,
                  sourceDocumentId: source.sourceDocumentId,
                  pageNumber,
                },
              }),
            ),
          );
      const illustrationScheduled = illustrations
        ? await step.run("recover-illustration-jobs", () =>
            dispatchIllustrations(),
          )
        : 0;
      return {
        illustrationScheduled,
        scheduled: pending.length,
        visualScheduled: visualPending.length,
      };
    },
  );
  const evidenceProcessor = createSubstitutionEvidenceProcessor(database);
  const evidence = client.createFunction(
    {
      id: "substitution-evidence-recover-v1",
      concurrency: 1,
      retries: 3,
      triggers: [{ cron: "*/15 * * * *" }],
    },
    async ({ step }) => {
      const due = await step.run("due-field-observations", () =>
        evidenceProcessor.due(10),
      );
      const results = [];
      for (const item of due)
        results.push(
          await step.run(`evidence-${item.eventId}`, () =>
            evidenceProcessor.process(item.storeId, item.eventId),
          ),
        );
      return { processed: results.length };
    },
  );
  return {
    client,
    recovery,
    dispatchEmailOriginals,
    dispatchIllustrations,
    functions: [
      resume,
      extract,
      recover,
      evidence,
      ...(emailOriginal ? [emailOriginal] : []),
      ...(illustration ? [illustration] : []),
      ...(visualPage ? [visualPage] : []),
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
