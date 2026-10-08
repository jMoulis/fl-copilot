import { describe, expect, it, vi } from "vitest";
const generation = vi.hoisted(() =>
  vi.fn(async (_input: Record<string, unknown>) => {
    void _input;
    return {
      output: {
        operations: [],
        tgIdeas: [],
        otherInformation: [],
        warnings: [],
      },
      response: { id: "test-response" },
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }),
);
vi.mock("ai", () => ({
  createGateway: () => (model: string) => model,
  generateText: generation,
  Output: { object: () => ({}) },
}));
import { createCommercialVisualProvider } from "./visual-provider";
describe("visual extraction week context", () => {
  it("sends the frozen Paris ISO week alongside the original PDF, separately from source dates", async () => {
    const provider = createCommercialVisualProvider({
      model: "test-model",
      gatewayApiKey: "test-only",
    });
    const bytes = new TextEncoder().encode("%PDF-1.7 test");
    await provider.extract(
      1,
      [
        {
          pageNumber: 1,
          width: 800,
          height: 600,
          rotation: 0,
          text: "Semaine 43",
          spans: [
            {
              index: 0,
              text: "Semaine 43",
              transform: [1, 0, 0, 1, 0, 0],
              width: 100,
              height: 12,
              direction: "ltr",
              hasEndOfLine: true,
            },
          ],
          warnings: [],
        },
      ],
      bytes,
      new Date("2026-10-11T21:59:00Z"),
    );
    const input = generation.mock.calls[0]![0];
    const messages = input.messages as Array<{
      content: Array<{ text?: string; data?: Uint8Array }>;
    }>;
    const context = JSON.parse(messages[0]!.content[0]!.text!);
    expect(context.CURRENT_WEEK).toMatchObject({
      year: 2026,
      number: 41,
      start: "2026-10-05",
      end: "2026-10-11",
    });
    expect(context.SOURCE_TEXT_PAGES[0].spans[0].text).toBe("Semaine 43");
    expect(messages[0]!.content[1]!.data).toEqual(bytes);
    expect(input.system).toContain("actual SALES period");
  });
});
