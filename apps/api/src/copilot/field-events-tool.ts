import { parisDate } from "@fl-copilot/domain";
import {
  serializeJournalNote,
  type JournalNoteDocument,
} from "../journal-note-sync";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotEventsReadInputSchema,
  copilotEventsReadResultSchema,
  copilotEvidenceSchema,
} from "@fl-copilot/domain";
import {
  serializeStoreProductEvent,
  type StoreProductEventDocument,
} from "../store-product-event-sync.js";
export async function readFieldEvents(db: Db, storeId: string, raw: unknown) {
  z.string().uuid().parse(storeId);
  const input = copilotEventsReadInputSchema.parse(raw);
  if (
    input.productId &&
    !(await db
      .collection<{ _id: string; storeId: string }>("products")
      .findOne({ _id: input.productId, storeId }))
  )
    throw Error("COPILOT_EVENTS_PRODUCT_UNAVAILABLE");
  const rows = await db
    .collection<StoreProductEventDocument>("storeProductEvents")
    .find({
      storeId,
      startedAt: { $lt: input.endAt },
      $or: [{ endedAt: null }, { endedAt: { $gt: input.startAt } }],
      ...(input.productId ? { productId: input.productId } : {}),
      ...(input.afterId ? { _id: { $gt: input.afterId } } : {}),
    })
    .sort({ _id: 1 })
    .maxTimeMS(2000)
    .limit(input.limit + 1)
    .toArray();
  const parsed = rows.map((row) => {
    const event = serializeStoreProductEvent(row);
    if (
      event.id !== row._id ||
      event.storeId !== storeId ||
      (input.productId && event.productId !== input.productId) ||
      event.startedAt >= input.endAt ||
      (event.endedAt && event.endedAt <= input.startAt) ||
      (input.afterId && event.id <= input.afterId)
    )
      throw Error("COPILOT_EVENTS_SCOPE_INVALID");
    return event;
  });
  // A page contains at most five distinct IDs when product episodes and store notes share the page.
  // Keeping both namespaces at an ID boundary prevents a tied UUID from being skipped.
  const endDay = parisDate(new Date(Date.parse(input.endAt) - 1).toISOString());
  const noteRows = input.productId
    ? []
    : await db
        .collection<JournalNoteDocument>("storeJournalNotes")
        .find({
          storeId,
          withdrawnAt: null,
          startDate: { $lte: endDay },
          $or: [
            { endDate: { $gte: parisDate(input.startAt) } },
            { endDate: null, startDate: { $gte: parisDate(input.startAt) } },
          ],
          ...(input.afterId ? { _id: { $gt: input.afterId } } : {}),
        })
        .sort({ _id: 1 })
        .maxTimeMS(2000)
        .limit(input.limit + 1)
        .toArray();
  const notes = noteRows.map((row) => {
    const note = serializeJournalNote(row);
    if (
      note.storeId !== storeId ||
      note.withdrawnAt ||
      note.startDate > endDay ||
      (note.endDate ?? note.startDate) < parisDate(input.startAt) ||
      (input.afterId && note.id <= input.afterId)
    )
      throw Error("COPILOT_EVENTS_SCOPE_INVALID");
    return note;
  });
  const ids = [
    ...new Set([...parsed.map((e) => e.id), ...notes.map((n) => n.id)]),
  ].sort();
  const selectedIds = ids.slice(
    0,
    parsed.length && notes.length ? Math.min(input.limit, 5) : input.limit,
  );
  const page = parsed.filter((e) => selectedIds.includes(e.id));
  const notePage = notes.filter((n) => selectedIds.includes(n.id));
  const hasMore = ids.length > selectedIds.length;
  const productIds = [...new Set(page.map((e) => e.productId))];
  const products = productIds.length
    ? await db
        .collection<{
          _id: string;
          storeId: string;
          label: string;
          deletedAt?: unknown;
          version?: number;
          isPetitPrix?: boolean;
        }>("products")
        .find({ storeId, _id: { $in: productIds } })
        .maxTimeMS(2000)
        .limit(10)
        .toArray()
    : [];
  if (
    products.some((p) => p.storeId !== storeId || !productIds.includes(p._id))
  )
    throw Error("COPILOT_EVENTS_SCOPE_INVALID");
  const events = page.map((event) => {
    const product = products.find((p) => p._id === event.productId);
    return {
      event,
      productLabel: product
        ? z.string().trim().min(1).max(240).parse(product.label) +
          (product.deletedAt ? " — Produit retiré" : "")
        : "Produit à identifier",
    };
  });
  const labels = {
    TENSION: "Tension",
    LOW_STOCK: "Stock bas signalé",
    OUT_OF_STOCK: "Rupture signalée",
    QUALITY_ISSUE: "Qualité signalée",
    PRICE_INCREASE: "Hausse de prix signalée",
    SUPPLIER_SHORTAGE: "Manque fournisseur signalé",
  };
  const statuses = {
    ACTIVE: "Non clôturée",
    CLOSED: "Clôturée",
    TO_REVIEW: "À examiner",
  };
  const severities = { LOW: "Faible", MEDIUM: "Moyenne", HIGH: "Forte" };
  const date = (s: string) =>
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(s));
  const evidence = events.map(({ event: e, productLabel }) => {
    const product = products.find((p) => p._id === e.productId);
    const marker = product
      ? product.isPetitPrix === true
        ? "Gamme Petit Prix marquée sur la fiche actuelle"
        : "Fiche actuelle non marquée Gamme Petit Prix"
      : "Marquage de gamme inconnu : fiche indisponible";
    return copilotEvidenceSchema.parse({
      id: `store-event/${createHash("sha256")
        .update(
          JSON.stringify([
            storeId,
            e,
            productLabel,
            product?.isPetitPrix ?? null,
            product?.version ?? null,
          ]),
        )
        .digest("hex")}`,
      sourceType: e.source === "USER" ? "EVENT" : "SOURCE_DOCUMENT",
      sourceId: e.id,
      sourceVersion: e.version,
      label: `${labels[e.type]} — ${productLabel}`,
      value: `${marker} (pas un historique de gamme à la date du signalement). ${statuses[e.status]} ; ${e.type === "OUT_OF_STOCK" && e.source === "USER" ? "constat" : "début"} ${date(e.startedAt)} ; ${e.endedAt ? "fin " + date(e.endedAt) : "sans date de fin connue"} ; capture ${date(e.clientCapturedAt)} (Europe/Paris). Gravité : ${e.severity ? severities[e.severity] : "non précisée"}. ${e.source === "USER" ? "Signalement magasin" : "Information issue d’un PDF, pas une observation magasin"}${e.status === "TO_REVIEW" ? ", à examiner" : ""}.${e.comment ? " Note : " + e.comment : ""} Aucun stock chiffré ni lien de causalité n’est établi.${e.type === "OUT_OF_STOCK" && e.source === "USER" ? " Le constat ne donne pas le début exact ni la durée continue de la rupture." : ""}`,
      factKind:
        e.source !== "USER"
          ? "SOURCE_INSTRUCTION"
          : e.status === "TO_REVIEW"
            ? "QUALITY"
            : "OBSERVED",
    });
  });
  for (const n of notePage)
    evidence.push(
      copilotEvidenceSchema.parse({
        id: `journal-note/${createHash("sha256").update(JSON.stringify(n)).digest("hex")}`,
        sourceType: "EVENT",
        sourceId: n.id,
        sourceVersion: n.version,
        label: "Note du magasin",
        value: `${n.text} Période déclarée : ${n.startDate}${n.endDate ? " au " + n.endDate : " (une journée)"}. Saisie : ${date(n.capturedAt)} (Europe/Paris). Déclaration du gestionnaire ; ce n’est ni une mesure vérifiée indépendamment ni une preuve d’effet sur les ventes. Une période à venir n’est pas une réalisation constatée.`,
        factKind: "QUALITY",
      }),
    );
  const nextAfterId = hasMore ? selectedIds.at(-1)! : null;
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        storeId,
        input,
        events,
        notePage,
        products.map((p) => [p._id, p.version, p.isPetitPrix]),
        hasMore,
      ]),
    )
    .digest("hex");
  evidence.push(
    copilotEvidenceSchema.parse({
      id: `store-event-coverage/${revision}`,
      sourceType: "DATA_QUALITY",
      sourceId: storeId,
      sourceVersion: null,
      label: `Couverture des observations — ${date(input.startAt)} au ${date(input.endAt)} (fin exclue)`,
      value: `${events.length} signalements produit et ${notePage.length} notes du magasin dans cette page${hasMore ? " ; d’autres observations restent à consulter" : " ; fin des observations enregistrées pour ce périmètre"}. Une absence de signalement ne prouve pas une absence de rupture. Une observation non clôturée peut être ancienne ; son statut ne prouve pas le stock actuel. Un chevauchement avec une variation de ventes ne prouve pas sa cause.`,
      factKind: "QUALITY",
    }),
  );
  return copilotEventsReadResultSchema.parse({
    startAt: input.startAt,
    endAt: input.endAt,
    productId: input.productId,
    events,
    hasMore,
    nextAfterId,
    evidence,
  });
}
