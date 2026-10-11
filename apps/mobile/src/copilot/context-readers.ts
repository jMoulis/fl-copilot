import { z } from "zod";
import { CopilotToolError, copilotToolRequestSchema } from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { TodaySummaryRepository } from "../today/today-summary";
import { WasteReceiptRepository } from "../documents/waste-receipt-repository";
import { readCommercialChoices } from "../commercial/offer-choice-repository";
import { readValidatedOffers } from "../commercial/validated-offer-repository";
import { commercialOfferValidationCurrent } from "@fl-copilot/commercial-core";
export function readOnlyToolDatabase(tx: OutboxDatabase) {
  return {
    getFirstAsync: tx.getFirstAsync.bind(tx),
    getAllAsync: tx.getAllAsync.bind(tx),
    runAsync: async () => {
      throw new CopilotToolError("FORBIDDEN");
    },
    withExclusiveTransactionAsync: async () => {
      throw new CopilotToolError("FORBIDDEN");
    },
  };
}
export async function readCopilotContext(
  tx: OutboxDatabase,
  storeId: string,
  request: z.infer<typeof copilotToolRequestSchema>,
) {
  switch (request.tool) {
    case "analytics.daily": {
      const summary = await new TodaySummaryRepository(tx).load(
        storeId,
        request.input.businessDate,
      );
      const snapshot = summary
        ? {
            businessDate: summary.businessDate,
            computedAt: summary.computedAt,
            origin: summary.origin,
            productCount: summary.productCount,
            kpis: summary.kpis,
            dataQuality: summary.dataQuality,
          }
        : null;
      return {
        requestedDate: request.input.businessDate,
        snapshot,
        message: snapshot
          ? "Chiffres quotidiens consultés. La couverture et la référence sont précisées pour chaque indicateur."
          : "Aucun calcul disponible pour ce jour. Les données manquantes ne sont pas des zéros.",
      };
    }
    case "waste.inspect": {
      const repo = new WasteReceiptRepository(readOnlyToolDatabase(tx));
      const receipt = await repo.getReceipt(request.input.receiptId);
      const visible =
        receipt?.storeId === storeId && !receipt.deletedAt ? receipt : null;
      const lines = visible ? await repo.listLines(visible.id) : [];
      if (lines.some((l) => l.storeId !== storeId))
        throw new CopilotToolError("FORBIDDEN");
      return {
        snapshot: visible ? { receipt: visible, lines } : null,
        message: visible
          ? "Ticket consulté. Les lignes extraites restent distinctes de la casse publiée."
          : "Ticket introuvable dans ce magasin.",
      };
    }
    case "commercial.offers": {
      const [choices, validations] = await Promise.all([
        readCommercialChoices(tx, storeId),
        readValidatedOffers(tx, storeId),
      ]);
      const matches = choices
        .filter(
          (r) =>
            r.entity.storeId === storeId &&
            r.entity.status === "RETAINED" &&
            r.entity.saleStart <= request.input.end &&
            r.entity.saleEnd >= request.input.start &&
            (!request.input.afterId || r.entity.id > request.input.afterId),
        )
        .sort((a, b) =>
          a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0,
        );
      const page = matches.slice(0, request.input.limit),
        hasMore = matches.length > page.length;
      return {
        start: request.input.start,
        end: request.input.end,
        offers: page.map((r) => ({
          choice: r.entity,
          syncState: r.syncState,
          validation:
            validations.find((v) =>
              commercialOfferValidationCurrent(v.entity, r.entity),
            )?.entity ?? null,
        })),
        hasMore,
        nextAfterId: hasMore ? page.at(-1)!.entity.id : null,
        message:
          "Offres retenues consultées. Une offre retenue ou validée ne prouve pas son exécution en rayon.",
      };
    }
    default:
      throw new CopilotToolError("INVALID_INPUT");
  }
}
