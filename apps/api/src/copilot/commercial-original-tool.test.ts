import { randomUUID, createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  copilotResponseSchema,
  copilotChoiceCreateInputSchema,
  copilotChoiceCreatePreviewSchema,
  copilotChoiceCreateModelInputSchema,
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
  bindCommercialOriginalChoiceInput,
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

it("binds choice sources only after the original is delivered, never accepting a model-supplied hash or nonexistent page", async () => {
  const f = fixture(),
    data = await import("../../../../scripts/test-choice-create-fixtures").then(
      (m) => m.choiceCreateFixture(storeId),
    );
  const input = {
    ...data.input,
    source: {
      kind: "PDF_ORIGINAL",
      sourceDocumentId: f.sourceDocumentId,
      pageNumber: 2,
      excerpt: "Semaine 44 : avocat 2,50 euros",
    },
    originalDescription: {
      operationKind: "PROSPECTUS",
      operationLabel: "Prospectus semaine 44",
      rawProductLabel: "Avocat",
    },
  };
  expect(() =>
    bindCommercialOriginalChoiceInput(input, f.factory.documents),
  ).toThrow("CHOICE_CREATE_ORIGINAL_NOT_READ");
  const originalInput = { sourceDocumentId: f.sourceDocumentId },
    output = await f.factory.tool.execute!(originalInput, call);
  expect(() =>
    bindCommercialOriginalChoiceInput(input, f.factory.documents),
  ).toThrow("CHOICE_CREATE_ORIGINAL_NOT_READ");
  await f.factory.tool.toModelOutput!({
    input: originalInput,
    output,
    toolCallId: call.toolCallId,
  });
  expect(
    bindCommercialOriginalChoiceInput(input, f.factory.documents).source,
  ).toEqual({ ...input.source, checksum: f.file.snapshot.source.checksum });
  for (const source of [
    { ...input.source, pageNumber: 3 },
    { ...input.source, sourceDocumentId: randomUUID() },
  ])
    expect(() =>
      bindCommercialOriginalChoiceInput(
        { ...input, source },
        f.factory.documents,
      ),
    ).toThrow("CHOICE_CREATE_ORIGINAL_NOT_READ");
  for (const extra of [
    { checksum: f.file.snapshot.source.checksum },
    { approved: true },
    { confidence: 1 },
  ])
    expect(
      copilotChoiceCreateModelInputSchema.safeParse({
        ...input,
        source: { ...input.source, ...extra },
      }).success,
    ).toBe(false);
  expect(
    bindCommercialOriginalChoiceInput(
      { ...data.input, originalDescription: null },
      f.factory.documents,
    ),
  ).toEqual(data.input);
});

it.each([
  { streaming: false, early: false },
  { streaming: true, early: false },
  { streaming: true, early: true },
])(
  "prepares a future offer from the actually delivered original through installed Responses, without extraction or business write (streaming $streaming, early proposal $early)",
  async ({ streaming, early }) => {
    const f = fixture(),
      data =
        await import("../../../../scripts/test-choice-create-fixtures").then(
          (m) => m.choiceCreateFixture(storeId),
        );
    const { projectCommercialOriginalOffer } =
      await import("@fl-copilot/commercial-core");
    const input = {
      source: {
        kind: "PDF_ORIGINAL",
        sourceDocumentId: f.sourceDocumentId,
        pageNumber: 2,
        excerpt: "Semaine 44 : avocat 2,50 euros",
      },
      originalDescription: {
        operationKind: "PROSPECTUS",
        operationLabel: "Prospectus S44",
        rawProductLabel: "Avocat",
      },
      productId: data.basis.product.id,
      saleStart: "2026-10-26",
      saleEnd: "2026-11-01",
      mechanism: {
        type: "FIXED_PRICE",
        amount: 2.5,
        currency: "EUR",
        unit: "PIECE",
      },
      note: null,
    };
    const canonical = copilotChoiceCreateInputSchema.parse({
      ...input,
      source: { ...input.source, checksum: f.file.snapshot.source.checksum },
    });
    const basis = {
      storeId,
      product: {
        ...data.basis.product,
        label: "AVOCAT PIECE",
        salesUnit: "PIECE",
      },
      offer: projectCommercialOriginalOffer({
        source: {
          ...input.source,
          kind: "PDF_ORIGINAL",
          checksum: f.file.snapshot.source.checksum,
        },
        operationKind: "PROSPECTUS",
        operationLabel: input.originalDescription.operationLabel,
        rawProductLabel: input.originalDescription.rawProductLabel,
      }),
    };
    const value = {
      status: "READY",
      existingChoice: null,
      input: canonical,
      basis,
      evidence: [
        {
          id: "choice-create-original",
          sourceType: "DATA_QUALITY",
          sourceId: f.sourceDocumentId,
          sourceVersion: null,
          label: "Choix proposé",
          value: "À confirmer",
          factKind: "QUALITY",
        },
      ],
    };
    const choiceCreate = vi.fn(async () => value),
      extraction = vi.fn(async () => {
        throw Error("EXTRACTION_MUST_NOT_RUN");
      });
    const batch = scoreCopilotPriorities({
        storeId,
        evaluatedAt,
        candidates: [priorityFixture("original-choice")],
      }),
      request: CopilotGenerationRequest = {
        requestId: randomUUID(),
        storeId,
        context: detectCopilotConflicts({ batch, intents: [] }),
        userQuestion: "Retiens cet avocat pour la semaine prochaine",
      };
    let calls = 0;
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)),
        definition = body.tools.find(
          (t: { name: string }) => t.name === "commercial_choice_create",
        );
      expect(definition.parameters.type).toBe("object");
      const original = definition.parameters.properties.source.anyOf.find(
        (branch: { properties: Record<string, unknown> }) =>
          branch.properties.kind,
      );
      expect(original.properties).not.toHaveProperty("checksum");
      expect(original.properties).not.toHaveProperty("approved");
      const current = calls++;
      if (early && current === 0)
        return envelope(
          [
            {
              type: "function_call",
              name: "commercial_choice_create",
              id: "fc_unread",
              call_id: "call_unread",
              arguments: JSON.stringify(input),
              status: "completed",
            },
          ],
          streaming,
        );
      const step = current - (early ? 1 : 0);
      if (step === 0)
        return envelope(
          [
            {
              type: "function_call",
              name: "commercial_pdf",
              id: "fc_original",
              call_id: "call_original",
              arguments: JSON.stringify({
                sourceDocumentId: f.sourceDocumentId,
              }),
              status: "completed",
            },
          ],
          streaming,
        );
      if (step === 1) {
        expect(JSON.stringify(body)).toContain(
          `data:application/pdf;base64,${Buffer.from(f.file.pdf).toString("base64")}`,
        );
        return envelope(
          [
            {
              type: "function_call",
              name: "commercial_choice_create",
              id: "fc_original_choice",
              call_id: "call_original_choice",
              arguments: JSON.stringify(input),
              status: "completed",
            },
          ],
          streaming,
        );
      }
      return envelope(
        [
          {
            id: "msg_original_choice",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  ...answer,
                  narrative: "Je te propose cette offre pour confirmation.",
                  documentReadings: [],
                }),
                annotations: [],
              },
            ],
          },
        ],
        streaming,
      );
    });
    const config = parseEnvironment({
      NODE_ENV: "test",
      OPENAI_API_KEY: "sk-test-only-not-a-real-secret",
      COPILOT_AI_MODEL: "test-model",
      COPILOT_AI_TIMEOUT_MS: "4000",
    });
    const result = await createCopilotAiProvider(config, transport, {
      daily: extraction,
      commercialPdf: extraction,
      commercialPdfOriginal: f.read,
      choiceCreateVersion: 2,
      choiceCreate: async (input) => {
        expect(input).toEqual(canonical);
        return copilotChoiceCreatePreviewSchema.parse(await choiceCreate());
      },
    }).generate(
      request,
      copilotResponseSchema,
      undefined,
      streaming ? vi.fn() : undefined,
    );
    expect(calls).toBe(early ? 4 : 3);
    expect(choiceCreate).toHaveBeenCalledOnce();
    expect(extraction).not.toHaveBeenCalled();
    expect(result.choiceCreates).toEqual([value]);
  },
);

it("finishes three explicitly requested original offers with real product resolutions even when the model calls tools serially", async () => {
  const f = fixture(),
    data = await import("../../../../scripts/test-choice-create-fixtures").then(
      (m) => m.choiceCreateFixture(storeId),
    ),
    { projectCommercialOriginalOffer } =
      await import("@fl-copilot/commercial-core");
  const specifications = [
    { label: "AVOCAT PIECE", amount: 2.5, unit: "PIECE" },
    { label: "TOMATE VRAC", amount: 1.99, unit: "KG" },
    { label: "BANANE VRAC", amount: 1.49, unit: "KG" },
  ] as const;
  const excerpts = specifications.map(
    (p) => `S44 ${p.label} ${p.amount} EUR/${p.unit}`,
  );
  f.file.pdf = commercialPdfFixture(["Semaine 44 2026", excerpts.join(" ; ")]);
  f.file.snapshot.source.checksum = `sha256:${createHash("sha256").update(f.file.pdf).digest("hex")}`;
  f.file.snapshot.source.sizeBytes = f.file.pdf.length;
  f.file.snapshot.evidence[0]!.id = `pdf-original/${f.file.snapshot.source.checksum.slice(7)}/${f.sourceDocumentId}`;
  const products = specifications.map((p) => ({
    ...data.basis.product,
    id: randomUUID(),
    label: p.label,
    salesUnit: p.unit,
  }));
  const inputs = specifications.map((p, i) => ({
    source: {
      kind: "PDF_ORIGINAL",
      sourceDocumentId: f.sourceDocumentId,
      pageNumber: 2,
      excerpt: excerpts[i],
    },
    originalDescription: {
      operationKind: "PROSPECTUS",
      operationLabel: "Prospectus S44",
      rawProductLabel: p.label,
    },
    productId: products[i]!.id,
    saleStart: "2026-10-26",
    saleEnd: "2026-11-01",
    mechanism: {
      type: "FIXED_PRICE",
      amount: p.amount,
      currency: "EUR",
      unit: p.unit,
    },
    note: null,
  }));
  const productSearch = vi.fn(async (input: { label: string | null }) => {
    const product = products.find((p) => p.label === input.label)!;
    return {
      status: "COMPLETE_CATALOG" as const,
      state: "AUTO_MATCH" as const,
      matchedProductId: product.id,
      candidateCount: 1,
      hasMoreCandidates: false,
      candidates: [
        {
          product,
          basis: "CANONICAL_LABEL" as const,
          score: 1,
          reasons: ["Libellé exact"],
        },
      ],
      missingIdentifiers: [],
      evidence: [],
    };
  });
  const choiceCreate = vi.fn(
    async (
      input: Parameters<
        NonNullable<
          NonNullable<
            Parameters<typeof createCopilotAiProvider>[2]
          >["choiceCreate"]
        >
      >[0],
    ) => {
      expect(input.source).toHaveProperty(
        "checksum",
        f.file.snapshot.source.checksum,
      );
      if (!("kind" in input.source)) throw Error("ORIGINAL_REQUIRED");
      return copilotChoiceCreatePreviewSchema.parse({
        input,
        status: "READY",
        existingChoice: null,
        basis: {
          storeId,
          product: products.find((p) => p.id === input.productId),
          offer: projectCommercialOriginalOffer({
            source: input.source,
            ...input.originalDescription!,
          }),
        },
        evidence: [
          {
            id: `proposal/${input.productId}`,
            sourceType: "DATA_QUALITY",
            sourceId: f.sourceDocumentId,
            sourceVersion: null,
            label: "Choix proposé",
            value: "À confirmer",
            factKind: "QUALITY",
          },
        ],
      });
    },
  );
  const batch = scoreCopilotPriorities({
      storeId,
      evaluatedAt,
      candidates: [priorityFixture("three-offers")],
    }),
    request: CopilotGenerationRequest = {
      requestId: randomUUID(),
      storeId,
      context: detectCopilotConflicts({ batch, intents: [] }),
      userQuestion: "Prépare ces trois offres pour la semaine prochaine",
    };
  let calls = 0;
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)),
      step = calls++;
    if (step < 7) {
      const index = Math.floor((step - 1) / 2),
        name =
          step === 0
            ? "commercial_pdf"
            : step % 2 === 1
              ? "product_search"
              : "commercial_choice_create",
        input =
          step === 0
            ? { sourceDocumentId: f.sourceDocumentId }
            : step % 2 === 1
              ? { label: products[index]!.label, identifiers: [] }
              : inputs[index];
      return envelope(
        [
          {
            type: "function_call",
            name,
            id: `fc_${step}`,
            call_id: `call_${step}`,
            arguments: JSON.stringify(input),
            status: "completed",
          },
        ],
        false,
      );
    }
    expect(body.tool_choice).toBeDefined();
    return envelope(
      [
        {
          id: "msg_three_offers",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                ...answer,
                narrative: "Les offres sont prêtes pour ta confirmation.",
                documentReadings: [],
              }),
              annotations: [],
            },
          ],
        },
      ],
      false,
    );
  });
  const config = parseEnvironment({
    NODE_ENV: "test",
    OPENAI_API_KEY: "sk-test-only-not-a-real-secret",
    COPILOT_AI_MODEL: "test-model",
    COPILOT_AI_TIMEOUT_MS: "4000",
  });
  const result = await createCopilotAiProvider(config, transport, {
    daily: vi.fn(),
    commercialPdfOriginal: f.read,
    choiceCreateVersion: 2,
    choiceCreate,
    productSearch,
  }).generate(request, copilotResponseSchema);
  expect(calls).toBe(8);
  expect(productSearch).toHaveBeenCalledTimes(3);
  expect(choiceCreate).toHaveBeenCalledTimes(3);
  expect(result.choiceCreates).toHaveLength(3);
});
