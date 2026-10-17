import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotPriceScenarioInputSchema,
  validateCopilotPriceScenarioResult,
  copilotMessageSchema,
  copilotConversationSchema,
  copilotMessageIsDeleted,
  readPriceScenarioQuestion,
  PRICE_SCENARIO_FIELDS,
  priceScenarioFormStateSchema,
  priceScenarioInputSchema,
  type PriceScenarioFormState,
  type CopilotMessage,
  type CopilotConversation,
  type copilotPriceScenarioResultSchema,
} from "@fl-copilot/domain";
import { calculatePriceScenario } from "@fl-copilot/analytics-core";
import type { z } from "zod";
type Scope = {
  storeId: string;
  ownerId: string;
  conversationId: string;
  parentMessageId: string;
};
/** Uses only private USER answers to canonical scenario forms, never model-authored amounts or official KPI writes. */
export async function readPriceScenario(db: Db, scope: Scope, raw: unknown) {
  const input = copilotPriceScenarioInputSchema.parse(raw);
  const filter = {
    storeId: scope.storeId,
    ownerId: scope.ownerId,
    conversationId: scope.conversationId,
  };
  const conversationRow = await db
    .collection<CopilotConversation & { _id: string }>("copilotConversations")
    .findOne(
      {
        _id: scope.conversationId,
        storeId: scope.storeId,
        ownerId: scope.ownerId,
      },
      { maxTimeMS: 2000 },
    );
  if (!conversationRow) throw Error("PRICE_SCENARIO_SCOPE");
  const { _id: cid, ...cp } = conversationRow;
  const conversation = copilotConversationSchema.parse(cp);
  if (
    cid !== conversation.id ||
    conversation.id !== scope.conversationId ||
    conversation.storeId !== scope.storeId ||
    conversation.ownerId !== scope.ownerId ||
    conversation.status !== "ACTIVE" ||
    conversation.deletedAt
  )
    throw Error("PRICE_SCENARIO_SCOPE");
  async function load(id: string) {
    const row = await db
      .collection<CopilotMessage & { _id: string }>("copilotMessages")
      .findOne({ _id: id, ...filter }, { maxTimeMS: 2000 });
    if (!row) throw Error("PRICE_SCENARIO_SOURCE");
    const { _id, ...payload } = row,
      m = copilotMessageSchema.parse(payload);
    if (
      _id !== m.id ||
      m.id !== id ||
      m.storeId !== scope.storeId ||
      m.ownerId !== scope.ownerId ||
      m.conversationId !== scope.conversationId ||
      copilotMessageIsDeleted(m, conversation)
    )
      throw Error("PRICE_SCENARIO_SOURCE");
    return m;
  }
  const parent = await load(scope.parentMessageId);
  if (parent.role !== "USER") throw Error("PRICE_SCENARIO_SOURCE");
  let status: "FORM_REQUIRED" | "CALCULATED" | "UNAVAILABLE" = "FORM_REQUIRED",
    form: PriceScenarioFormState | null = null,
    calculation: z.infer<
      typeof copilotPriceScenarioResultSchema
    >["calculation"] = null,
    answerMessageId: string | null = null;
  if (input.action === "PREPARE")
    form = {
      unit: input.unit!,
      values: [null, null, null, null],
      fields: [...PRICE_SCENARIO_FIELDS],
    };
  else {
    try {
      const answer = await load(input.answerMessageId ?? parent.id);
      answerMessageId = answer.id;
      if (
        answer.role !== "USER" ||
        !answer.replyToMessageId ||
        answer.attachments.length ||
        answer.createdAt > parent.createdAt
      )
        throw Error("PRICE_SCENARIO_SOURCE");
      const question = await load(answer.replyToMessageId),
        artifact = readPriceScenarioQuestion(question);
      const [original, assistant] = await Promise.all([
        load(artifact.definition.parentUserMessageId),
        load(artifact.content.assistantMessageId),
      ]);
      if (
        original.role !== "USER" ||
        assistant.role !== "ASSISTANT" ||
        assistant.replyToMessageId !== original.id ||
        assistant.createdAt < original.createdAt ||
        question.createdAt < assistant.createdAt ||
        answer.createdAt <= question.createdAt
      )
        throw Error("PRICE_SCENARIO_SOURCE");
      const corrected = await db.collection("copilotMessages").findOne(
        {
          ...filter,
          role: "USER",
          supersedesMessageId: { $in: [answer.id, original.id] },
          createdAt: { $lte: parent.createdAt },
        },
        { projection: { _id: 1 }, maxTimeMS: 2000 },
      );
      if (corrected) throw Error("PRICE_SCENARIO_SOURCE");
      const lines = answer.text.split("\n");
      if (
        lines[0] !== "Réponse — " + artifact.definition.title ||
        lines.length !== artifact.definition.fields.length + 1
      )
        throw Error("PRICE_SCENARIO_SOURCE");
      const values = [
        ...artifact.state.values,
      ] as PriceScenarioFormState["values"];
      const invalid: number[] = [];
      artifact.definition.fields.forEach((field, i) => {
        if (field.type !== "NUMBER") throw Error("PRICE_SCENARIO_SOURCE");
        const prefix = field.label + " : ",
          suffix = field.unit === "NONE" ? "" : " " + field.unit,
          line = lines[i + 1]!;
        if (!line.startsWith(prefix) || (suffix && !line.endsWith(suffix)))
          throw Error("PRICE_SCENARIO_SOURCE");
        const text = line.slice(
            prefix.length,
            suffix ? -suffix.length : undefined,
          ),
          index = PRICE_SCENARIO_FIELDS.indexOf(
            field.key as (typeof PRICE_SCENARIO_FIELDS)[number],
          );
        const match = /^\+?(\d+)(?:[.,](\d{1,6}))?$/.exec(text);
        const normalized = match
          ? match[1]!.replace(/^0+(?=\d)/, "") +
            (match[2] ? "." + match[2] : "")
          : null;
        const parsed =
          priceScenarioInputSchema.shape.currentPrice.shape.amount.safeParse(
            normalized,
          );
        values[index] = parsed.success ? parsed.data : null;
        if (values[index] === null) invalid.push(index);
      });
      const quote = (amount: string | null) => ({
        amount,
        unit: artifact.state.unit,
        currency: "EUR" as const,
        taxBasis: "EXCLUDING_VAT" as const,
      });
      calculation = calculatePriceScenario({
        currentPrice: quote(values[0]),
        proposedPrice: quote(values[1]),
        purchaseCost: {
          ...quote(values[2]),
          quality: values[2] === null ? "UNKNOWN" : "KNOWN",
        },
        currentVolume: { amount: values[3], unit: artifact.state.unit },
      });
      if (calculation.status === "AVAILABLE") status = "CALCULATED";
      else {
        const names = {
          currentPrice: "current_price",
          proposedPrice: "proposed_price",
          purchaseCost: "purchase_cost",
          currentVolume: "current_volume",
        } as const;
        const reviewCost = calculation.issues.some(
          (i) =>
            i.code === "NON_POSITIVE_CURRENT_CONTRIBUTION" ||
            i.code === "NON_POSITIVE_PROPOSED_CONTRIBUTION",
        );
        const fields = PRICE_SCENARIO_FIELDS.filter(
          (key, i) =>
            invalid.includes(i) ||
            (key === "purchase_cost" && reviewCost) ||
            calculation!.issues.some((issue) => names[issue.field] === key),
        );
        form = priceScenarioFormStateSchema.parse({
          unit: artifact.state.unit,
          values,
          fields,
        });
      }
    } catch {
      status = "UNAVAILABLE";
      form = null;
      calculation = null;
      if (input.answerMessageId !== null)
        answerMessageId = input.answerMessageId;
    }
  }
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        scope,
        input,
        status,
        form,
        calculation,
        answerMessageId,
      ]),
    )
    .digest("hex");
  const sourceId = answerMessageId ?? scope.storeId;
  const evidence: z.infer<typeof copilotPriceScenarioResultSchema>["evidence"] =
    [
      {
        id: `price-scenario/${hash}/quality`,
        sourceType: "DATA_QUALITY",
        sourceId,
        sourceVersion: null,
        label: "Simulation de contribution théorique hors TVA",
        value:
          status === "CALCULATED"
            ? "Calcul fondé sur vos hypothèses déclarées dans le formulaire. Ce seuil n’est pas une prévision de demande. Aucun prix, coût ou chiffre officiel du magasin n’a été modifié. L’arrondi supérieur est un incrément numérique, pas une mesure de stock ou de faisabilité."
            : status === "FORM_REQUIRED"
              ? calculation?.issues.map((i) => i.message).join(" ") ||
                "Confirmez les hypothèses de prix et de coût hors TVA, dans l’unité indiquée. Aucun calcul de contribution n’est fourni avant votre réponse."
              : "La réponse au formulaire est indisponible, modifiée, supprimée ou incompatible. Reprendre les hypothèses dans un nouveau formulaire ; aucun montant n’est supposé.",
        factKind: "QUALITY",
      },
    ];
  if (calculation?.status === "AVAILABLE") {
    const { numbers: n, assumptions: a } = calculation;
    const labels = {
      currentUnitContribution: "Contribution actuelle HT par unité",
      proposedUnitContribution: "Contribution envisagée HT par unité",
      currentContributionAmount: "Contribution actuelle HT à conserver",
      approximateRequiredVolume: "Volume théorique requis, approximation",
      approximateVolumeChangePct: "Variation théorique de volume (%)",
      roundedUpRequiredVolume: "Volume requis arrondi au-dessus",
      roundedUpVolumeChangePct: "Variation de volume après arrondi (%)",
    };
    for (const key of Object.keys(labels) as Array<keyof typeof labels>)
      evidence.push({
        id: `price-scenario/${hash}/${key}`,
        sourceType: "COMPARISON",
        sourceId,
        sourceVersion: 1,
        label: `${labels[key]} — ${n.unit === "PACK" ? "unité conditionnée" : n.unit}`,
        value: n[key],
        factKind: "DERIVED",
      });
    evidence.push({
      id: `price-scenario/${hash}/rounding`,
      sourceType: "COMPARISON",
      sourceId,
      sourceVersion: 1,
      label: `Incrément de l’arrondi supérieur — ${n.unit === "PACK" ? "unité conditionnée" : n.unit}`,
      value: n.roundingIncrement,
      factKind: "DERIVED",
    });
    for (const key of [
      "currentPrice",
      "proposedPrice",
      "purchaseCost",
      "currentVolume",
    ] as const)
      evidence.push({
        id: `price-scenario/${hash}/input/${key}`,
        sourceType: "DATA_QUALITY",
        sourceId,
        sourceVersion: 1,
        label: {
          currentPrice: "Prix actuel HT déclaré",
          proposedPrice: "Prix envisagé HT déclaré",
          purchaseCost: "Coût unitaire HT déclaré connu",
          currentVolume: "Volume de référence déclaré",
        }[key],
        value: a[key].amount,
        factKind: "SOURCE_INSTRUCTION",
      });
  }
  return validateCopilotPriceScenarioResult(scope.storeId, input, {
    storeId: scope.storeId,
    input,
    status,
    form,
    calculation,
    answerMessageId,
    evidence,
  });
}
