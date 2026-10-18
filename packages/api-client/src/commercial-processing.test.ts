import { afterEach, expect, it, vi } from "vitest";
const randomUUID = () => globalThis.crypto.randomUUID();
import { ApiClient, ApiClientError } from "./index";
import { commercialReviewFixture } from "../../../scripts/test-commercial-processing-fixtures";
import { commercialProcessingReviewSchema } from "@fl-copilot/sync-contracts";
afterEach(() => vi.unstubAllGlobals());
it("uses authenticated store-scoped status and a single explicit operation receipt", async () => {
  const review = commercialReviewFixture(),
    store = randomUUID(),
    op = randomUUID(),
    requests: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify(
          init.method === "GET"
            ? review
            : {
                sourceDocumentId: review.sourceDocumentId,
                operationId: op,
                status: "REQUESTED",
              },
        ),
      );
    }),
  );
  const api = new ApiClient("https://test.invalid");
  expect(
    await api.commercialProcessing(
      "test-token",
      store,
      review.sourceDocumentId,
    ),
  ).toEqual(review);
  expect(
    await api.resumeCommercialProcessing(
      "test-token",
      store,
      review.sourceDocumentId,
      { operationId: op, basisHash: review.basisHash },
    ),
  ).toMatchObject({ status: "REQUESTED" });
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    `/api/v1/commercial/${review.sourceDocumentId}/processing`,
    `/api/v1/commercial/${review.sourceDocumentId}/resume`,
  ]);
  for (const r of requests) {
    expect(new Headers(r.init.headers).get("authorization")).toBe(
      "Bearer test-token",
    );
    expect(new Headers(r.init.headers).get("x-store-id")).toBe(store);
  }
  expect(JSON.parse(requests[1]!.init.body as string)).toEqual({
    operationId: op,
    basisHash: review.basisHash,
  });
});
it("rejects leaked internals and contradictory stages without replacing the native cache", async () => {
  const review = commercialReviewFixture();
  for (const value of [
    { ...review, objectKey: "private/original.pdf" },
    {
      ...review,
      stages: [review.stages[0], review.stages[0], review.stages[2]],
    },
    {
      ...review,
      stages: review.stages.map((s) => ({
        ...s,
        readyPages: 3,
        totalPages: 2,
      })),
    },
  ])
    expect(commercialProcessingReviewSchema.safeParse(value).success).toBe(
      false,
    );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ...review, objectKey: "private" })),
    ),
  );
  await expect(
    new ApiClient("https://test.invalid").commercialProcessing(
      "token",
      randomUUID(),
      review.sourceDocumentId,
    ),
  ).rejects.toBeInstanceOf(ApiClientError);
});
