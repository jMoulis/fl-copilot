import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import {
  copilotResponseSchema,
  storePhotoSnapshotSchema,
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
import { createStorePhotoTool } from "./store-photo-tool";
import {
  createCopilotAiProvider,
  type CopilotGenerationRequest,
} from "./ai-provider";
import { validateCopilotResponse } from "./response-service";
import { parseEnvironment } from "../config";

async function fixture() {
  const image = new Uint8Array(
    await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#e87c35" },
    })
      .jpeg()
      .toBuffer(),
  );
  const checksum = `sha256:${createHash("sha256").update(image).digest("hex")}`,
    sourceDocumentId = randomUUID();
  const snapshot = storePhotoSnapshotSchema.parse({
    status: "AVAILABLE",
    source: {
      sourceDocumentId,
      sourceType: "STORE_PHOTO",
      filename: "rayon.jpg",
      checksum,
      registeredAt: "2026-10-20T12:00:00.000Z",
    },
    frame: {
      checksum,
      mimeType: "image/jpeg",
      width: 32,
      height: 24,
      sizeBytes: image.length,
    },
    evidence: [
      {
        id: `store-photo/${sourceDocumentId}/${checksum.slice(7)}`,
        sourceType: "SOURCE_DOCUMENT",
        sourceId: sourceDocumentId,
        sourceVersion: null,
        label: "Photo du rayon",
        value: "Original consulté",
        factKind: "QUALITY",
      },
    ],
  });
  const reference = {
    sourceDocumentId,
    sourceType: "STORE_PHOTO" as const,
    filename: "rayon.jpg",
    registeredAt: "2026-10-20T12:00:00.000Z",
    status: "CONFIRMED",
    mediaType: "image/jpeg",
  };
  const read = vi.fn(async () => ({
    image: image.slice(),
    snapshot: structuredClone(snapshot),
  }));
  const abort = new AbortController(),
    run = vi.fn(async (_: string, load: () => Promise<unknown>) => load());
  const options = { references: [reference], signal: abort.signal, read, run };
  return { image, snapshot, sourceDocumentId, reference, read, abort, options };
}
const callOptions = { toolCallId: "call-photo", messages: [], context: {} };

it("keeps pixels out of the JSON result and emits genuine multimodal content deterministically", async () => {
  const f = await fixture(),
    t = createStorePhotoTool(f.options),
    input = { sourceDocumentId: f.sourceDocumentId };
  const output = await t.execute!(input, callOptions);
  expect(output).toEqual(f.snapshot);
  expect(JSON.stringify(output)).not.toContain(
    Buffer.from(f.image).toString("base64"),
  );
  const model = await t.toModelOutput!({
    input,
    output,
    toolCallId: "call-photo",
  });
  expect(model).toMatchObject({
    type: "content",
    value: [
      { type: "text" },
      {
        type: "file",
        mediaType: "image/jpeg",
        data: { type: "data", data: Buffer.from(f.image).toString("base64") },
      },
    ],
  });
  expect(
    await t.toModelOutput!({ input, output, toolCallId: "call-photo" }),
  ).toEqual(model);
  const changed = structuredClone(f.snapshot);
  changed.source.filename = "changed.jpg";
  expect(
    await t.toModelOutput!({
      input,
      output: changed,
      toolCallId: "call-photo",
    }),
  ).toMatchObject({ type: "text" });
  f.abort.abort();
  expect(
    await t.toModelOutput!({ input, output, toolCallId: "call-photo" }),
  ).toMatchObject({ type: "text" });
});

it.each(["unknown", "pending", "receipt", "aborted", "tampered"])(
  "refuses %s photos before supplying any image",
  async (mode) => {
    const f = await fixture();
    if (mode === "pending") f.reference.status = "PENDING";
    if (mode === "receipt")
      f.reference.sourceType = "WASTE_RECEIPT" as "STORE_PHOTO";
    if (mode === "aborted") f.abort.abort();
    if (mode === "tampered") f.image[10] ^= 1;
    const t = createStorePhotoTool(f.options);
    await expect(
      t.execute!(
        {
          sourceDocumentId:
            mode === "unknown" ? randomUUID() : f.sourceDocumentId,
        },
        callOptions,
      ),
    ).rejects.toThrow(/STORE_PHOTO/);
    if (mode !== "tampered") expect(f.read).not.toHaveBeenCalled();
  },
);

it("reserves the three-image budget before parallel reads finish", async () => {
  const fs = await Promise.all(Array.from({ length: 4 }, fixture));
  const read = vi.fn(async (input: { sourceDocumentId: string }) => {
    await Promise.resolve();
    const f = fs.find((f) => f.sourceDocumentId === input.sourceDocumentId)!;
    return { image: f.image, snapshot: f.snapshot };
  });
  const t = createStorePhotoTool({
    ...fs[0]!.options,
    references: fs.map((f) => f.reference),
    read,
  });
  const results = await Promise.allSettled(
    fs.map((f) =>
      t.execute!({ sourceDocumentId: f.sourceDocumentId }, callOptions),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
  expect(read).toHaveBeenCalledTimes(3);
});

function envelope(output: unknown[]) {
  return new Response(
    JSON.stringify({
      id: "resp-test",
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
it.each([
  ["attachedSources", false],
  ["recentSources", false],
  ["attachedSources", true],
  ["recentSources", true],
] as const)(
  "supplies actual pixels through the existing Responses adapter from %s (discovery %s), preserving numerical grounding",
  async (context, discovery) => {
    const f = await fixture(),
      batch = scoreCopilotPriorities({
        storeId,
        evaluatedAt,
        candidates: [priorityFixture("photo")],
      }),
      activity = vi.fn();
    const request: CopilotGenerationRequest = {
      requestId: randomUUID(),
      storeId,
      context: detectCopilotConflicts({ batch, intents: [] }),
      userQuestion: "Que penses-tu de la présentation de ce rayon ?",
      [context]: [f.reference],
    };
    const output = {
      language: "fr-FR",
      summary: "La présentation peut être examinée.",
      facts: [{ evidenceId: f.snapshot.evidence[0]!.id }],
      narrative:
        "Je peux examiner la présentation visible, à confirmer sur place. {{source:0}}",
      interpretation: [],
      recommendations: [],
      questions: [],
    };
    let calls = 0;
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      const step = calls++;
      if (discovery && step === 0) {
        expect(
          body.tools.some((t: { name: string }) => t.name === "store_photo"),
        ).toBe(false);
        return envelope([
          {
            type: "function_call",
            name: "find_tools",
            id: "fc_search",
            call_id: "call_search",
            arguments: JSON.stringify({ query: "store_photo" }),
            status: "completed",
          },
        ]);
      }
      if (step === (discovery ? 1 : 0)) {
        expect(
          body.tools.some((t: { name: string }) => t.name === "store_photo"),
        ).toBe(true);
        return envelope([
          {
            type: "function_call",
            name: "store_photo",
            id: "fc_photo",
            call_id: "call_photo",
            arguments: JSON.stringify({ sourceDocumentId: f.sourceDocumentId }),
            status: "completed",
          },
        ]);
      }
      const sent = JSON.stringify(body);
      expect(sent).toContain(
        `data:image/jpeg;base64,${Buffer.from(f.image).toString("base64")}`,
      );
      expect(sent).toContain(f.snapshot.evidence[0]!.id);
      return envelope([
        {
          id: "msg-photo",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(output),
              annotations: [],
            },
          ],
        },
      ]);
    });
    const config = parseEnvironment({
      NODE_ENV: "test",
      OPENAI_API_KEY: "sk-test-only-not-a-real-secret",
      COPILOT_AI_MODEL: "test-model",
      COPILOT_AI_TIMEOUT_MS: "2000",
    });
    const unused = async () => {
      throw Error("Unexpected canonical read");
    };
    const result = await createCopilotAiProvider(config, transport, {
      storePhoto: f.read,
      daily: unused,
      ...(discovery
        ? {
            period: unused,
            productChanges: unused,
            productSearch: unused,
            commercialDocuments: unused,
            commercialPdf: unused,
            commercialPlan: unused,
            recommendationDecisions: unused,
            recommendationTracking: unused,
            receiptDocuments: unused,
            receipt: unused,
            fieldEvents: unused,
            conversationHistory: unused,
          }
        : {}),
    }).generate(request, copilotResponseSchema, undefined, undefined, activity);
    expect(transport).toHaveBeenCalledTimes(discovery ? 3 : 2);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(result.toolEvidence).toEqual(f.snapshot.evidence);
    expect(JSON.stringify(result)).not.toContain(
      Buffer.from(f.image).toString("base64"),
    );
    expect(
      activity.mock.calls
        .filter(([a]) => a.stage === "DOCUMENTS")
        .map(([a]) => a.stage),
    ).toEqual(["DOCUMENTS", "DOCUMENTS"]);
    const grounded = { ...request, evidence: result.toolEvidence };
    expect(validateCopilotResponse(result.output, grounded)).toMatchObject({
      summary: output.summary,
    });
    expect(() =>
      validateCopilotResponse(
        { ...output, narrative: "Le chiffre d’affaires est de 9000 €." },
        grounded,
      ),
    ).toThrow("UNSUPPORTED_NUMBER");
  },
);
