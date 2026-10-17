import { z } from "zod";
import {
  priceScenarioInputSchema,
  priceScenarioResultSchema,
} from "./price-scenario";
import {
  copilotInformationInputSchema,
  readCopilotInformationRequest,
} from "./copilot-information-request";
import { copilotEvidenceSchema } from "./copilot-candidate";
const unit = z.enum(["KG", "PIECE", "PACK"]);
export const priceScenarioFieldSchema = z.enum([
  "current_price",
  "proposed_price",
  "purchase_cost",
  "current_volume",
]);
export const PRICE_SCENARIO_FIELDS = priceScenarioFieldSchema.options;
const amount = priceScenarioInputSchema.shape.currentPrice.shape.amount;
export const priceScenarioFormStateSchema = z
  .strictObject({
    unit,
    values: z.tuple([amount, amount, amount, amount]),
    fields: z
      .array(priceScenarioFieldSchema)
      .min(1)
      .max(4)
      .refine((v) => new Set(v).size === v.length),
  })
  .refine((s) =>
    s.values.every(
      (v, i) => v !== null || s.fields.includes(PRICE_SCENARIO_FIELDS[i]!),
    ),
  );
export type PriceScenarioFormState = z.infer<
  typeof priceScenarioFormStateSchema
>;
const labels = [
  "Prix actuel HT",
  "Prix envisagé HT",
  "Coût d’achat unitaire connu HT",
  "Volume de référence",
];
const units = {
  KG: { price: "€/kg", quantity: "kg", title: "au kg" },
  PIECE: { price: "€/pièce", quantity: "pièces", title: "à la pièce" },
  PACK: {
    price: "€/unité conditionnée",
    quantity: "unités conditionnées",
    title: "à l’unité conditionnée",
  },
};
export function priceScenarioInformationInput(raw: PriceScenarioFormState) {
  const s = priceScenarioFormStateSchema.parse(raw),
    u = units[s.unit];
  const kept = PRICE_SCENARIO_FIELDS.flatMap((key, i) =>
    !s.fields.includes(key) && s.values[i] !== null
      ? [`${labels[i]} : ${s.values[i]} ${i === 3 ? u.quantity : u.price}`]
      : [],
  );
  return copilotInformationInputSchema.parse({
    title: `Simulation de prix — ${u.title}`,
    reason: `Hypothèses déclarées hors TVA. Le coût d’achat doit être connu. Ce seuil n’est pas une prévision de demande.${kept.length ? " Conservé : " + kept.join(" ; ") + "." : ""}`,
    fields: s.fields.map((key) => {
      const i = PRICE_SCENARIO_FIELDS.indexOf(key);
      return {
        key,
        label: `${labels[i]} (${i === 3 ? u.quantity : u.price})`,
        required: true,
        type: "NUMBER",
        unit: i === 3 ? (s.unit === "PACK" ? "NONE" : s.unit) : "EUR",
      };
    }),
  });
}
export function priceScenarioBasisToken(raw: PriceScenarioFormState) {
  const s = priceScenarioFormStateSchema.parse(raw);
  return "price-scenario.v1/" + JSON.stringify([s.unit, ...s.values, s.fields]);
}
export function readPriceScenarioQuestion(raw: unknown) {
  const artifact = readCopilotInformationRequest(raw),
    token = artifact.definition.basisToken,
    prefix = "price-scenario.v1/";
  if (!token.startsWith(prefix)) throw Error("PRICE_SCENARIO_FORM_INVALID");
  const tuple = z
    .tuple([
      unit,
      amount,
      amount,
      amount,
      amount,
      z.array(priceScenarioFieldSchema),
    ])
    .parse(JSON.parse(token.slice(prefix.length)));
  const state = priceScenarioFormStateSchema.parse({
    unit: tuple[0],
    values: tuple.slice(1, 5),
    fields: tuple[5],
  });
  const expected = priceScenarioInformationInput(state);
  if (
    JSON.stringify({
      title: artifact.definition.title,
      reason: artifact.definition.reason,
      fields: artifact.definition.fields,
    }) !== JSON.stringify(expected) ||
    token !== priceScenarioBasisToken(state)
  )
    throw Error("PRICE_SCENARIO_FORM_INVALID");
  return { ...artifact, state };
}
export const copilotPriceScenarioInputSchema = z
  .strictObject({
    action: z.enum(["PREPARE", "CALCULATE"]),
    unit: unit.nullable(),
    answerMessageId: z.uuid().nullable(),
  })
  .refine((v) =>
    v.action === "PREPARE"
      ? v.unit !== null && v.answerMessageId === null
      : v.unit === null,
  );
export const copilotPriceScenarioResultSchema = z
  .strictObject({
    storeId: z.uuid(),
    input: copilotPriceScenarioInputSchema,
    status: z.enum(["FORM_REQUIRED", "CALCULATED", "UNAVAILABLE"]),
    form: priceScenarioFormStateSchema.nullable(),
    calculation: priceScenarioResultSchema.nullable(),
    answerMessageId: z.uuid().nullable(),
    evidence: z.array(copilotEvidenceSchema).min(1).max(20),
  })
  .refine((r) =>
    r.status === "CALCULATED"
      ? r.form === null &&
        r.calculation?.status === "AVAILABLE" &&
        r.answerMessageId !== null
      : r.status === "FORM_REQUIRED"
        ? r.form !== null &&
          (r.calculation === null || r.calculation.status === "UNAVAILABLE")
        : r.form === null && r.calculation === null,
  );
export function validateCopilotPriceScenarioResult(
  storeId: string,
  rawInput: unknown,
  raw: unknown,
) {
  const input = copilotPriceScenarioInputSchema.parse(rawInput),
    r = copilotPriceScenarioResultSchema.parse(raw);
  if (
    r.storeId !== storeId ||
    JSON.stringify(input) !== JSON.stringify(r.input) ||
    (input.action === "PREPARE" &&
      (r.status !== "FORM_REQUIRED" ||
        r.form?.unit !== input.unit ||
        r.calculation !== null ||
        r.answerMessageId !== null ||
        r.form.values.some((v) => v !== null) ||
        r.form.fields.length !== 4)) ||
    (input.action === "CALCULATE" &&
      input.answerMessageId !== null &&
      r.answerMessageId !== input.answerMessageId)
  )
    throw Error("PRICE_SCENARIO_SCOPE");
  if (
    input.action === "CALCULATE" &&
    r.status === "FORM_REQUIRED" &&
    (!r.calculation || !r.answerMessageId)
  )
    throw Error("PRICE_SCENARIO_SCOPE");
  if (r.calculation && r.form) {
    const a = r.calculation.assumptions;
    const values = [
      a.currentPrice.amount,
      a.proposedPrice.amount,
      a.purchaseCost.amount,
      a.currentVolume.amount,
    ];
    const names = {
      currentPrice: "current_price",
      proposedPrice: "proposed_price",
      purchaseCost: "purchase_cost",
      currentVolume: "current_volume",
    } as const;
    if (
      r.form.unit !== a.currentVolume.unit ||
      JSON.stringify(r.form.values) !== JSON.stringify(values) ||
      r.calculation.issues.some((i) => !r.form!.fields.includes(names[i.field]))
    )
      throw Error("PRICE_SCENARIO_SCOPE");
  }
  if (
    r.evidence.some((e) => ![storeId, r.answerMessageId].includes(e.sourceId))
  )
    throw Error("PRICE_SCENARIO_SCOPE");
  return r;
}
