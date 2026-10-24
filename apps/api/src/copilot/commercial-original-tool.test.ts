import { randomUUID, createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  copilotResponseSchema,
  type CopilotOriginalPdfRead,
} from "@fl-copilot/domain";
import {
  scoreCopilotPriorities,
  detectCopilotConflicts,
} from "@fl-copilot/analytics-core";
import {
  priorityFixture,
  priorityStoreId as storeId,
  priorityEvaluatedAt as evaluatedAt,
} from "../../../../scripts/test-copilot-priority-fixtures";
import {
  createCommercialOriginalTool,
  bindCommercialOriginalReadings,
} from "./commercial-original-tool";
import {
  createCopilotAiProvider,
  type CopilotGenerationRequest,
} from "./ai-provider";
import { validateCopilotResponse } from "./response-service";
import { renderAnswerText } from "./answer-text";
import { parseEnvironment } from "../config";
import { commercialPdfFixture } from "../../test/fixtures/commercial-pdf";

function fixture() {
  const sourceDocumentId = randomUUID();
  const pdf = commercialPdfFixture([
    "Semaine 43 : tomate 1,99 euros",
    "Semaine 44 : avocat 2,50 euros",
  ]);
  const file: CopilotOriginalPdfRead = {
    pdf,
    snapshot: {
      status: "AVAILABLE",
      source: {
        sourceDocumentId,
        filename: "prochaines-semaines.pdf",
        checksum: `sha256:${createHash("sha256").update(pdf).digest("hex")}`,
        sizeBytes: pdf.length,
        pageCount: 2,
        registeredAt: "2026-10-01T10:00:00.000Z",
      },
      evidence: [
        {
          id: `pdf-original/${createHash("sha256").update(pdf).digest("hex")}/${sourceDocumentId}`,
          sourceId: sourceDocumentId,
          sourceVersion: null,
          sourceType: "SOURCE_DOCUMENT",
          factKind: "QUALITY",
          label: "PDF original",
          value: "prochaines-semaines.pdf",
        },
      ],
    },
  };
  const abort = new AbortController(),
    read = vi.fn(async () => file);
  const factory = createCommercialOriginalTool({
    signal: abort.signal,
    read,
    run: async (_, load) => load(),
  });
  return { file, sourceDocumentId, abort, read, factory };
}
const call = { toolCallId: "pdf-read", messages: [], context: {} };
const answer = {
  language: "fr-FR",
  summary: "Voici les offres annoncées par le document.",
  facts: [],
  narrative: "Pour la préparation à venir, le document annonce {{document:0}}.",
  interpretation: [],
  recommendations: [],
  questions: [],
};

it("delivers actual original PDF bytes with all weeks, without an extraction result, URL or saved binary", async () => {
  const f = fixture(),
    input = { sourceDocumentId: f.sourceDocumentId };
  const output = await f.factory.tool.execute!(input, call);
  expect(output).toEqual(f.file.snapshot);
  expect(JSON.stringify(output)).not.toContain(
    Buffer.from(f.file.pdf).toString("base64"),
  );
  const content = await f.factory.tool.toModelOutput!({
    input,
    output,
    toolCallId: call.toolCallId,
  });
  expect(content).toMatchObject({
    type: "content",
    value: [
      { type: "text" },
      {
        type: "file",
        mediaType: "application/pdf",
        data: {
          type: "data",
          data: Buffer.from(f.file.pdf).toString("base64"),
        },
      },
    ],
  });
  expect(f.factory.documents.size).toBe(1);
  const duplicate = await f.factory.tool.toModelOutput!({
    input,
    output,
    toolCallId: call.toolCallId,
  });
  expect(duplicate).toMatchObject({
    type: "content",
    value: [{ type: "text" }],
  });
  expect(JSON.stringify(duplicate)).not.toContain('"type":"file"');
});
it.each(["FOREIGN", "CORRUPT", "ABORT", "BUDGET_REJECTED"])(
  "never authorizes a reading for %s",
  async (mode) => {
    const f = fixture(),
      input = { sourceDocumentId: f.sourceDocumentId };
    if (mode === "FOREIGN")
      f.file.snapshot.source.sourceDocumentId = randomUUID();
    if (mode === "CORRUPT") f.file.pdf[0] = 0;
    if (mode === "ABORT") f.abort.abort();
    if (mode === "BUDGET_REJECTED") {
      const output = await f.factory.tool.execute!(input, call);
      void output;
      await f.factory.tool.toModelOutput!({
        input,
        output: { unavailable: true },
        toolCallId: "reject",
      });
    } else await expect(f.factory.tool.execute!(input, call)).rejects.toThrow();
    expect(f.factory.documents.size).toBe(0);
  },
);
it("binds source observations to a delivered original/page, preserving source classification and automatic citations", async () => {
  const f = fixture(),
    input = { sourceDocumentId: f.sourceDocumentId },
    output = await f.factory.tool.execute!(input, call);
  await f.factory.tool.toModelOutput!({ input, output, toolCallId: "pdf" });
  const raw = {
    ...answer,
    documentReadings: [
      {
        sourceDocumentId: f.sourceDocumentId,
        pageNumber: 2,
        text: "Avocat annoncé à 2,50 € pour la semaine 44",
      },
    ],
  };
  const bound = bindCommercialOriginalReadings(raw, f.factory.documents);
  expect(bound.evidence[0]).toMatchObject({
    sourceId: f.sourceDocumentId,
    factKind: "SOURCE_INSTRUCTION",
    sourceType: "SOURCE_DOCUMENT",
  });
  expect(bound.evidence[0]!.detail).toContain("non vérifiée automatiquement");
  const parsed = copilotResponseSchema.parse(bound.output);
  const rendered = renderAnswerText(
    parsed.narrative!,
    parsed.facts,
    bound.evidence,
  );
  expect(rendered).toContain("2,50 €");
  expect(rendered).toContain("[Source]");
  expect(JSON.stringify(bound.output)).not.toContain("documentReadings");
  expect(bindCommercialOriginalReadings(raw, f.factory.documents)).toEqual(
    bound,
  );
  expect(() => bindCommercialOriginalReadings(raw, new Map())).toThrow(
    "OBSERVATION_SCOPE",
  );
  expect(() =>
    bindCommercialOriginalReadings(
      {
        ...raw,
        documentReadings: [{ ...raw.documentReadings[0], pageNumber: 3 }],
      },
      f.factory.documents,
    ),
  ).toThrow("OBSERVATION_SCOPE");
  expect(() =>
    bindCommercialOriginalReadings(
      { ...raw, narrative: "{{document:8}}" },
      f.factory.documents,
    ),
  ).toThrow("REFERENCE_INVALID");
});
it("rejects malformed source observation references instead of exposing template syntax", () => {
  expect(() =>
    bindCommercialOriginalReadings(
      { ...answer, narrative: "{{document:bad}}", documentReadings: [] },
      new Map(),
    ),
  ).toThrow("REFERENCE_INVALID");
});
it("does not expose incomplete source references during streaming", () => {
  const partial = bindCommercialOriginalReadings(
    {
      ...answer,
      documentReadings: [{ sourceDocumentId: "incomplete" }],
      narrative: "Le document annonce {{document:0",
    },
    new Map(),
    true,
  );
  expect((partial.output as { narrative: string }).narrative).toBe(
    "Le document annonce ",
  );
  expect(partial.evidence).toEqual([]);
});

function envelope(output: unknown[], streaming = false) {
  if (streaming) {
    const events: unknown[] = [
      {
        type: "response.created",
        response: { id: "resp_pdf", model: "test-model", created_at: 1 },
      },
    ];
    for (const [i, raw] of output.entries()) {
      const item = raw as {
        type: string;
        id: string;
        arguments?: string;
        content?: Array<{ text: string }>;
      };
      events.push({
        type: "response.output_item.added",
        output_index: i,
        item: { ...item, ...(item.arguments ? { arguments: "" } : {}) },
      });
      if (item.type === "message") {
        const text = item.content![0]!.text;
        for (let at = 0; at < text.length; at += 35)
          events.push({
            type: "response.output_text.delta",
            item_id: item.id,
            output_index: i,
            delta: text.slice(at, at + 35),
          });
      }
      events.push({ type: "response.output_item.done", output_index: i, item });
    }
    events.push({
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    });
    return new Response(
      events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  }
  return new Response(
    JSON.stringify({
      id: "resp_pdf",
      object: "response",
      created_at: 1,
      model: "test-model",
      status: "completed",
      incomplete_details: null,
      output,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}
it.each([false, true])(
  "reads the original and answers about next week without extraction, through the installed Responses transport (streaming %s)",
  async (streaming) => {
    const f = fixture(),
      batch = scoreCopilotPriorities({
        storeId,
        evaluatedAt,
        candidates: [priorityFixture("pdf")],
      });
    const request: CopilotGenerationRequest = {
      requestId: randomUUID(),
      storeId,
      context: detectCopilotConflicts({ batch, intents: [] }),
      userQuestion: "Préparons la semaine prochaine avec ce PDF",
    };
    let calls = 0;
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      if (calls++ === 0)
        return envelope(
          [
            {
              type: "function_call",
              name: "commercial_pdf",
              id: "fc_pdf",
              call_id: "call_pdf",
              arguments: JSON.stringify({
                sourceDocumentId: f.sourceDocumentId,
              }),
              status: "completed",
            },
          ],
          streaming,
        );
      expect(JSON.stringify(body)).toContain(
        `data:application/pdf;base64,${Buffer.from(f.file.pdf).toString("base64")}`,
      );
      expect(body.text.format.schema.properties).toHaveProperty(
        "documentReadings",
      );
      return envelope(
        [
          {
            id: "msg_pdf",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  ...answer,
                  documentReadings: [
                    {
                      sourceDocumentId: f.sourceDocumentId,
                      pageNumber: 2,
                      text: "L’avocat est annoncé à 2,50 € en semaine 44",
                    },
                  ],
                }),
                annotations: [],
              },
            ],
          },
        ],
        streaming,
      );
    });
    const extraction = vi.fn(async () => {
      throw Error("Must not depend on extraction");
    });
    const config = parseEnvironment({
      NODE_ENV: "test",
      OPENAI_API_KEY: "sk-test-only-not-a-real-secret",
      COPILOT_AI_MODEL: "test-model",
      COPILOT_AI_TIMEOUT_MS: "2000",
    });
    const partial = vi.fn();
    const result = await createCopilotAiProvider(config, transport, {
      daily: extraction,
      commercialPdfOriginal: f.read,
      commercialPdf: extraction,
    }).generate(
      request,
      copilotResponseSchema,
      undefined,
      streaming ? partial : undefined,
    );
    if (streaming) {
      expect(partial).toHaveBeenCalled();
      expect(
        partial.mock.calls.some(
          ([value, evidence]) =>
            JSON.stringify(value).includes("{{value:") &&
            evidence.some(
              (e: { factKind: string }) => e.factKind === "SOURCE_INSTRUCTION",
            ),
        ),
      ).toBe(true);
    }
    expect(calls).toBe(2);
    expect(extraction).not.toHaveBeenCalled();
    const grounded = { ...request, evidence: result.toolEvidence };
    const validated = validateCopilotResponse(result.output, grounded);
    expect(
      renderAnswerText(
        validated.narrative!,
        validated.facts,
        result.toolEvidence!,
      ),
    ).toContain("2,50 €");
    expect(() =>
      validateCopilotResponse(
        { ...validated, narrative: "Le CA magasin est de 9000 €." },
        grounded,
      ),
    ).toThrow("UNSUPPORTED_NUMBER");
    expect(JSON.stringify(result)).not.toContain(
      Buffer.from(f.file.pdf).toString("base64"),
    );
  },
);
