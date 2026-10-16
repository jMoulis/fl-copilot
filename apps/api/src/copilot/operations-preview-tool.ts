import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotOperationsInputSchema,
  copilotOperationsPreviewSchema,
  copilotVisibleStoreSettingsSchema,
  validateOperationsBasis,
  prepareOperationsRequest,
  operationsUnchanged,
} from "@fl-copilot/domain";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master.js";
import {
  serializeStoreProductEvent,
  type StoreProductEventDocument,
} from "../store-product-event-sync.js";
import {
  serializeStoreContext,
  type StoreContextDocument,
} from "../store-context-sync.js";
export async function readOperationsPreview(
  db: Db,
  storeId: string,
  raw: unknown,
  now = () => new Date().toISOString(),
) {
  z.uuid().parse(storeId);
  const input = copilotOperationsInputSchema.parse(raw);
  const eventRow =
    input.kind === "FIELD_CLOSE"
      ? await db
          .collection<StoreProductEventDocument>("storeProductEvents")
          .findOne({ _id: input.eventId, storeId }, { maxTimeMS: 2000 })
      : null;
  const event = eventRow ? serializeStoreProductEvent(eventRow) : null;
  const productId =
    input.kind === "FIELD_CAPTURE" ? input.productId : event?.productId;
  const productRow = productId
    ? await db
        .collection<ProductDocument>("products")
        .findOne({ _id: productId, storeId }, { maxTimeMS: 2000 })
    : null;
  const settingsRow =
    input.kind === "SETTINGS"
      ? await db
          .collection<StoreContextDocument>("storeContextSettings")
          .findOne({ _id: storeId, storeId }, { maxTimeMS: 2000 })
      : null;
  const settings = settingsRow
    ? copilotVisibleStoreSettingsSchema.parse(
        (({ position, ...visible }) => {
          void position;
          return visible;
        })(serializeStoreContext(settingsRow)),
      )
    : null;
  const basis = {
    product: productRow ? serializeProductDocument(productRow) : null,
    event,
    settings,
  };
  let status:
      | "READY"
      | "INSPECTED"
      | "UNCHANGED"
      | "UNAVAILABLE"
      | "NEEDS_INFORMATION"
      | "BLOCKED" = "READY",
    missingFields: string[] = [];
  try {
    validateOperationsBasis(storeId, input, basis);
  } catch {
    status = "UNAVAILABLE";
  }
  if (status === "READY" && input.action === "INSPECT") status = "INSPECTED";
  if (status === "READY")
    try {
      const r = prepareOperationsRequest(
        input,
        basis,
        "00000000-0000-4000-8000-000000000001",
      );
      if (
        r.tool === "store.event.capture" &&
        (basis.product?.status !== "ACTIVE" ||
          basis.product.deletedAt ||
          Date.parse(r.input.startedAt) > Date.parse(now()) ||
          (r.input.endedAt && Date.parse(r.input.endedAt) > Date.parse(now())))
      )
        status = "BLOCKED";
      if (
        r.tool === "store.event.close" &&
        (!event ||
          event.source !== "USER" ||
          r.input.endedAt < event.startedAt ||
          Date.parse(r.input.endedAt) > Date.parse(now()) ||
          (event.status === "CLOSED" && event.endedAt !== r.input.endedAt))
      )
        status = "BLOCKED";
      if (r.tool === "store.settings.save" && settings) {
        const addressChanged =
          r.input.city !== settings.city ||
          r.input.postalCode !== settings.postalCode;
        if (
          addressChanged &&
          settings.locationMode === "POINT" &&
          r.input.location === "KEEP"
        ) {
          status = "NEEDS_INFORMATION";
          missingFields = ["location"];
        } else if (
          addressChanged &&
          input.kind === "SETTINGS" &&
          input.patch.schoolZone === undefined &&
          settings.schoolZone !== null
        ) {
          status = "NEEDS_INFORMATION";
          missingFields = ["schoolZone"];
        }
      }
      if (status === "READY" && operationsUnchanged(input, basis))
        status = "UNCHANGED";
    } catch (e) {
      if (e instanceof z.ZodError) {
        status = "NEEDS_INFORMATION";
        missingFields = [
          ...new Set(
            e.issues.map((i) => String(i.path.at(-1) ?? "information")),
          ),
        ].slice(0, 10);
      } else status = "BLOCKED";
    }
  const h = createHash("sha256")
    .update(JSON.stringify([storeId, input, basis, status, missingFields]))
    .digest("hex");
  return copilotOperationsPreviewSchema.parse({
    input,
    status,
    basis,
    missingFields,
    evidence: [
      {
        id: `operations-preview/${h}`,
        sourceType: "DATA_QUALITY",
        sourceId:
          input.kind === "FIELD_CLOSE" ? input.eventId : (productId ?? storeId),
        sourceVersion:
          event?.version ?? basis.product?.version ?? settings?.version ?? null,
        label:
          input.kind === "SETTINGS"
            ? "Réglages du magasin"
            : "Observation terrain",
        value:
          status === "READY"
            ? "Proposition préparée, à confirmer ; aucune donnée enregistrée. Une observation n’est pas un stock chiffré ni une preuve de causalité. Les réglages n’accèdent pas au GPS et ne déclenchent pas la météo."
            : status === "INSPECTED"
              ? "État synchronisé consulté sans modification. Les coordonnées du magasin restent masquées."
              : status === "UNCHANGED"
                ? "Cette clôture ou cette configuration est déjà enregistrée ; aucune modification."
                : status === "NEEDS_INFORMATION"
                  ? `Informations à préciser : ${missingFields.join(", ")}. Un changement de commune ne confirme pas automatiquement la zone scolaire ni le remplacement du point enregistré.`
                  : "Action indisponible ou bloquée : vérifier la cible, les dates et l’origine utilisateur de l’observation. Aucune modification.",
        factKind: "QUALITY",
      },
    ],
  });
}
