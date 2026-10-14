import { expect, it } from "vitest";
import { copilotInformationInputSchema } from "./copilot-information-request";
const field = {
  type: "DATE",
  key: "start_date",
  label: "Début de période",
  required: true,
};
it("accepts targeted typed requests without injected IDs or model prefills", () => {
  expect(
    copilotInformationInputSchema.parse({
      title: "Préciser la période",
      reason: "Les dates manquent.",
      fields: [field],
    }).fields,
  ).toHaveLength(1);
  for (const addition of [
    { storeId: "foreign" },
    { operationId: "fake" },
    { prefill: { start_date: "2026-10-14" } },
  ])
    expect(() =>
      copilotInformationInputSchema.parse({
        title: "Période",
        reason: "Dates manquantes.",
        fields: [field],
        ...addition,
      }),
    ).toThrow();
});
it("bounds questions and rejects duplicate keys, unsupported files and credential requests", () => {
  const base = { title: "Préciser", reason: "Information manquante." };
  for (const fields of [
    [field, field],
    Array.from({ length: 5 }, (_, index) => ({
      ...field,
      key: `date_${index}`,
    })),
    [{ ...field, type: "FILE" }],
    [
      {
        type: "TEXT",
        key: "auth_token",
        label: "Clé API",
        required: true,
        maxLength: 120,
      },
    ],
  ])
    expect(() =>
      copilotInformationInputSchema.parse({ ...base, fields }),
    ).toThrow();
});
