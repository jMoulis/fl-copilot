import { expect, it } from "vitest";
import {
  contextCheckpointInputSchema,
  validateContextNotes,
} from "./copilot-context-checkpoint";
const id = "11111111-1111-4111-8111-111111111111";
const source = {
  id,
  role: "USER",
  text: "Mon objectif : préparer quatre TG.\n\nLe passage doit rester libre sur 1,20 m.",
};
const note = {
  topic: "CONSTRAINT" as const,
  sourceMessageId: id,
  quote: "Le passage doit rester libre sur 1,20 m.",
};
it("keeps whole exact paragraphs without splitting dimensions, conditions or identifiers", () => {
  expect(validateContextNotes({ notes: [note] }, [source]).notes).toEqual([
    note,
  ]);
  for (const quote of [
    "1,20",
    "Le passage doit rester libre",
    "Le passage doit rester libre sur 1,2 m.",
    "autre contrainte",
  ]) {
    expect(() =>
      validateContextNotes({ notes: [{ ...note, quote }] }, [source]),
    ).toThrow();
  }
});
it("does not promote assistant proposals to user goals or confirmed constraints", () => {
  expect(() =>
    validateContextNotes({ notes: [note] }, [{ ...source, role: "ASSISTANT" }]),
  ).toThrow();
  expect(
    validateContextNotes(
      { notes: [{ ...note, topic: "ASSISTANT_PROPOSAL" }] },
      [{ ...source, role: "ASSISTANT" }],
    ).notes,
  ).toHaveLength(1);
  expect(() =>
    validateContextNotes(
      { notes: [{ ...note, topic: "ASSISTANT_PROPOSAL" }] },
      [source],
    ),
  ).toThrow();
  expect(() => validateContextNotes({ notes: [note] }, [])).toThrow();
});
it("bounds source notes, rejects duplicates and cannot carry write authority", () => {
  for (const value of [
    { notes: [] },
    { notes: [note, note] },
    { notes: [note], approved: true },
    { notes: [{ ...note, quote: "a".repeat(1001) }] },
    {
      notes: Array.from({ length: 5 }, (_, i) => ({
        ...note,
        quote: String(i).repeat(1000),
      })),
    },
  ]) {
    expect(contextCheckpointInputSchema.safeParse(value).success).toBe(false);
  }
});

it("bounds encoded context and preserves a new file even when selected paragraphs are unchanged", async () => {
  const { isContextCheckpointUnchanged } =
    await import("./copilot-context-checkpoint");
  expect(
    contextCheckpointInputSchema.safeParse({
      notes: Array.from({ length: 3 }, (_, i) => ({
        ...note,
        quote: String(i) + "\0".repeat(999),
      })),
    }).success,
  ).toBe(false);
  const content = {
    kind: "CONTEXT_CHECKPOINT" as const,
    schemaVersion: 1 as const,
    assistantMessageId: id,
    throughUserMessageId: id,
    throughSourceHash: "0".repeat(64),
    previousCheckpointId: null,
    partial: true as const,
    notes: [{ ...note, sourceHash: "0".repeat(64) }],
    sourceDocumentIds: [id],
    sourceReferencesOmitted: false,
  };
  expect(isContextCheckpointUnchanged(content, { notes: [note] }, [id])).toBe(
    true,
  );
  expect(
    isContextCheckpointUnchanged(content, { notes: [note] }, [
      "22222222-2222-4222-8222-222222222222",
    ]),
  ).toBe(false);
});
