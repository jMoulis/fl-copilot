import { CommercialPreparationRepository } from "../commercial/week-preparation-repository";
import { NeedUnitRepository } from "../needs/repository";
import { SourceDocumentRepository } from "../documents/source-document-repository";
import { StoreProductEventRepository } from "../needs/store-event-repository";
import { readSubstituteSnapshot } from "../needs/lookup-repository";
import { StoreContextRepository } from "../store/context-repository";
import {
  WeeklyContextRepository,
  contextIsStale,
} from "../store/weekly-context-repository";
import { z } from "zod";
import { CopilotToolError, copilotToolRequestSchema } from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { TodaySummaryRepository } from "../today/today-summary";
import { WasteReceiptRepository } from "../documents/waste-receipt-repository";
import {
  CommercialChoiceRepository,
  readCommercialChoices,
} from "../commercial/offer-choice-repository";
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
  observedAt: string,
) {
  switch (request.tool) {
    case "commercial.choice.inspect": {
      const value = await new CommercialChoiceRepository(
        readOnlyToolDatabase(tx),
        async () => {
          throw new CopilotToolError("FORBIDDEN");
        },
      ).get(storeId, request.input.choiceId);
      return {
        snapshot: value
          ? {
              entity: value.entity,
              syncState: value.syncState,
              remoteVersion: value.remoteVersion,
            }
          : null,
        message: value
          ? "Choix commercial consulté. Son statut ne prouve pas l’exécution en rayon."
          : "Choix commercial introuvable dans ce magasin.",
      };
    }

    case "commercial.preparation.inspect": {
      const value = await new CommercialPreparationRepository(
        readOnlyToolDatabase(tx),
        async () => {
          throw new CopilotToolError("FORBIDDEN");
        },
      ).get(storeId, request.input.weekStart);
      return {
        snapshot: value
          ? {
              entity: value.entity,
              syncState: value.syncState,
              remoteVersion: value.remoteVersion,
            }
          : null,
        message: value
          ? "Brouillon commercial consulté. Il ne représente pas une implantation exécutée."
          : "Aucun brouillon commercial disponible pour cette semaine.",
      };
    }

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
    case "store.events": {
      const rows = await new StoreProductEventRepository(
        readOnlyToolDatabase(tx),
      ).list(storeId);
      const matches = rows
        .filter(
          (r) =>
            r.entity.storeId === storeId &&
            (!request.input.productId ||
              r.entity.productId === request.input.productId) &&
            r.entity.startedAt < request.input.endAt &&
            (!r.entity.endedAt || r.entity.endedAt > request.input.startAt) &&
            (!request.input.afterId || r.entity.id > request.input.afterId),
        )
        .sort((a, b) =>
          a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0,
        );
      const page = matches.slice(0, request.input.limit),
        hasMore = matches.length > page.length;
      return {
        startAt: request.input.startAt,
        endAt: request.input.endAt,
        events: page.map((r) => ({ entity: r.entity, syncState: r.syncState })),
        hasMore,
        nextAfterId: hasMore ? page.at(-1)!.entity.id : null,
        message:
          "Observations consultées. Elles ne prouvent ni le stock actuel ni la cause d’une variation de ventes.",
      };
    }
    case "substitution.lookup": {
      const at = request.input.at ?? observedAt;
      if (Date.parse(at) > Date.parse(observedAt))
        throw new CopilotToolError("INVALID_INPUT");
      const snapshot = await readSubstituteSnapshot(
        tx,
        storeId,
        request.input.productId,
        request.input.needUnitId,
        at,
      );
      const r = snapshot.result,
        page = r.candidates.slice(
          request.input.offset,
          request.input.offset + request.input.limit,
        ),
        hasMore = request.input.offset + page.length < r.candidates.length;
      return {
        productId: request.input.productId,
        evaluatedAt: r.evaluatedAt,
        ruleVersion: r.ruleVersion,
        lookupStatus: r.status,
        candidates: page.map((c) => ({
          productId: c.productId,
          label: snapshot.labels[c.productId] ?? "Produit",
          availability: c.availability,
          relationships: c.relationships,
          events: c.events,
        })),
        candidateCount: r.candidates.length,
        hasMore,
        nextOffset: hasMore ? request.input.offset + page.length : null,
        excluded: r.excluded.slice(0, 25),
        excludedCount: r.excluded.length,
        excludedHasMore: r.excluded.length > 25,
        message:
          "Substitutions consultées selon les règles partagées. La disponibilité réelle reste inconnue ; les relations refusées ne sont pas réactivées.",
      };
    }
    case "store.week": {
      const settings = await new StoreContextRepository(
        readOnlyToolDatabase(tx),
      ).get(storeId);
      if (settings && settings.entity.storeId !== storeId)
        throw new CopilotToolError("FORBIDDEN");
      const context = settings
        ? await new WeeklyContextRepository(tx).get(
            settings.entity,
            request.input.weekStart,
          )
        : null;
      if (
        context &&
        (context.storeId !== storeId ||
          context.weekStart !== request.input.weekStart)
      )
        throw new CopilotToolError("FORBIDDEN");
      if (context)
        for (const key of [
          "weather",
          "publicHolidays",
          "schoolHolidays",
        ] as const)
          if (
            contextIsStale(context[key], new Date(observedAt)) &&
            context[key].status === "AVAILABLE"
          )
            context[key].status = "STALE";
      return {
        weekStart: request.input.weekStart,
        settings: settings
          ? {
              city: settings.entity.city,
              postalCode: settings.entity.postalCode,
              timezone: settings.entity.timezone,
              schoolZone: settings.entity.schoolZone,
              syncState: settings.syncState,
            }
          : null,
        context,
        message: context
          ? "Contexte local consulté avec sa validité et ses sources. La météo est une prévision, pas une explication certaine des ventes."
          : "Aucun contexte disponible pour cette semaine et cette configuration. Aucune recherche réseau n’a été lancée.",
      };
    }
    case "source.reference": {
      const document = await new SourceDocumentRepository(
        readOnlyToolDatabase(tx),
      ).getDocument(request.input.sourceDocumentId);
      const d =
        document?.storeId === storeId && !document.deletedAt ? document : null;
      return {
        source: d
          ? {
              sourceDocumentId: d.id,
              sourceType: d.sourceType,
              filename: d.originalFilename ?? null,
              businessPeriodStart: d.businessPeriodStart ?? null,
              businessPeriodEnd: d.businessPeriodEnd ?? null,
              processingStatus: d.localProcessingStatus,
              uploadStatus: d.remoteUploadStatus,
              syncState: d.syncState,
              openAction:
                d.sourceType === "WEEKLY_COMMERCIAL_PDF"
                  ? { kind: "COMMERCIAL_ORIGINAL", sourceDocumentId: d.id }
                  : null,
            }
          : null,
        message: d
          ? "Source retrouvée. L’ouverture du PDF utilise le service autorisé et renouvelle le lien à la demande."
          : "Source introuvable dans ce magasin.",
      };
    }
    case "need.list": {
      const all = await new NeedUnitRepository(readOnlyToolDatabase(tx)).list(
        storeId,
      );
      const matching = all
        .filter(
          (r) =>
            r.entity.storeId === storeId &&
            (!request.input.afterId || r.entity.id > request.input.afterId),
        )
        .sort((a, b) =>
          a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0,
        );
      const page = matching.slice(0, request.input.limit),
        hasMore = matching.length > page.length;
      return {
        needs: page.map((r) => ({ entity: r.entity, syncState: r.syncState })),
        hasMore,
        nextAfterId: hasMore ? page.at(-1)!.entity.id : null,
        message:
          "Besoins clients consultés avec leur statut. Un besoin désactivé conserve son code et son historique.",
      };
    }
    default:
      throw new CopilotToolError("INVALID_INPUT");
  }
}
