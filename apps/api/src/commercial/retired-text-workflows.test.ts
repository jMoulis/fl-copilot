import { expect, it, vi } from "vitest";
import { createCommercialInngestWorkflows } from "./inngest-workflows";
it("registers visual reading and the existing recovery workflows without a second text-model consumer", () => {
  const extract = vi.fn();
  const database = {
    getDb: vi.fn(),
    close: async () => {},
    checkHealth: async () => "connected" as const,
  };
  const w = createCommercialInngestWorkflows(
    database,
    "test-event-key",
    "signkey-test-only",
    { model: "test-model", extract },
  );
  const ids = w.functions.map((f) => f.id());
  expect(ids).toContain("commercial-pdf-extract-pages-v1");
  expect(ids).toContain("commercial-pdf-visual-page-v1");
  expect(ids).toContain("commercial-pdf-resume-v1");
  expect(ids).not.toContain("commercial-pdf-ai-page-v1");
  expect(ids).not.toContain("commercial-pdf-ai-document-v1");
  expect(extract).not.toHaveBeenCalled();
  expect(database.getDb).not.toHaveBeenCalled();
});
