import { expect, it } from "vitest";
import { copilotAnswerSourcesSchema } from "./copilot-answer-source";
import {
  copilotMessageSchema,
  copilotMessageContent,
} from "./copilot-conversation";
import { chatFixture } from "../../../scripts/test-chat-fixtures";
let sequence = 0;
const randomUUID = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const sources = [
  {
    label: "CA",
    value: "Qualification conservée",
    sourceId: "canonical",
    sourceType: "KPI",
  },
];
it("permits independently bounded source metadata only on assistant messages", () => {
  const f = chatFixture(randomUUID);
  for (const role of ["USER", "TOOL"])
    expect(
      copilotMessageSchema.safeParse({
        ...f.message,
        role,
        answerSources: sources,
      }).success,
    ).toBe(false);
  const message = copilotMessageSchema.parse({
    ...f.message,
    role: "ASSISTANT",
    answerSources: sources,
  });
  expect(message.answerSources).toEqual(sources);
  expect(copilotMessageContent(message)).toEqual(
    copilotMessageContent({ ...message, answerSources: undefined }),
  );
});
it("rejects empty, oversized and invalid source tables rather than truncating provenance", () => {
  for (const invalid of [
    [],
    Array.from({ length: 97 }, () => sources[0]),
    Array.from({ length: 60 }, () => ({
      ...sources[0],
      value: "x".repeat(10000),
    })),
    [{ ...sources[0], analyticsIndex: 96 }],
    [{ ...sources[0], value: "x".repeat(10001) }],
  ])
    expect(copilotAnswerSourcesSchema.safeParse(invalid).success).toBe(false);
});
