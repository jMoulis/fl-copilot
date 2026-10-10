import {
  commercialWeekPlanSchema,
  commercialValidatedOfferSchema,
  type CommercialWeekPlan,
  type CommercialValidatedOffer,
  type CommercialVisualPageOutput,
} from "@fl-copilot/domain";
import { commercialOfferValidationSource } from "./offer-validation";
import {
  commercialItemWeekStatus,
  currentCommercialWeek,
} from "./commercial-week";
import type { CommercialComparisonPage } from "./document-version-comparison";
export const COMMERCIAL_TENSION_RULE_VERSION = "commercial-tensions.v1";
type Fields = CommercialVisualPageOutput["operations"][number]["fields"];
export type CommercialTension = {
  id: string;
  source: "COMMERCIAL_DOCUMENT";
  productId: string | null;
  association: "VALIDATED_OFFER" | "EXACT_IDENTIFIER" | "UNRESOLVED";
  status: "ANNOUNCED" | "REVIEW";
  reason: "IDENTITY" | "PERIOD" | "EVIDENCE" | "CONFLICTING_SIGNAL" | null;
  label: string;
  signals: Fields;
  sourceDocumentId: string;
  readingId: string;
  checksum: string;
  pageNumber: number;
  operationIndex: number | null;
  itemIndex: number | null;
  // Associated offer sale window; never an asserted market-tension duration.
  planningWindow: { start: string; end: string } | null;
};
export type CommercialIdentifier = {
  storeId: string;
  productId: string;
  type: string;
  value: string;
  status: string;
  deletedAt?: string | null;
  syncState: string;
};
const normalized = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
function tensionText(s: string) {
  const t = normalized(s);
  return (
    /\b(tensions?|penurie|ruptures?|approvisionnements? (?:difficiles?|limites?)|offre (?:reduite|limitee)|disponibilites? (?:reduites?|limitees?))\b/.test(
      t,
    ) &&
    !/\b(pas|aucun|aucune|sans|fin|resorbee|levee|terminee|abondant|abondante|stabilise|stabilisee)\b/.test(
      t,
    )
  );
}
/** Source-only projection: cannot create a store event, relationship, task or plan mutation. */
export function commercialPlanTensions(input: {
  plan: CommercialWeekPlan;
  validated: CommercialValidatedOffer[];
  pages: CommercialComparisonPage[];
  identifiers: CommercialIdentifier[];
}) {
  const plan = commercialWeekPlanSchema.parse(input.plan),
    week = currentCommercialWeek(new Date(`${plan.weekStart}T12:00:00Z`));
  const selectedPages = input.pages.filter(
    (p) =>
      p.storeId === plan.storeId &&
      p.status === "READY" &&
      p.reading &&
      plan.offers.some(
        (o) =>
          o.sourceReference.sourceDocumentId === p.sourceDocumentId &&
          o.sourceReference.checksum === p.checksum,
      ),
  );
  const validated = new Map(
    input.validated
      .filter((v) => v.storeId === plan.storeId)
      .map((v) => [v.id, commercialValidatedOfferSchema.parse(v)]),
  );
  for (const offer of plan.offers) {
    const v = validated.get(offer.validationId);
    if (
      !v ||
      v.choice.id !== offer.choiceId ||
      v.choice.version !== offer.choiceVersion ||
      v.choice.productId !== offer.productId ||
      v.choice.saleStart !== offer.saleStart ||
      v.choice.saleEnd !== offer.saleEnd ||
      selectedPages.find((p) => p.id === v.choice.source.readingId)
        ?.pageNumber !== offer.sourceReference.pageNumber ||
      (
        [
          "sourceDocumentId",
          "readingId",
          "checksum",
          "operationIndex",
          "itemIndex",
        ] as const
      ).some((k) => v.choice.source[k] !== offer.sourceReference[k]) ||
      JSON.stringify(v.choice.mechanism) !==
        JSON.stringify(offer.customerMechanism)
    )
      return {
        status: "SOURCE_UNAVAILABLE" as const,
        ruleVersion: COMMERCIAL_TENSION_RULE_VERSION,
        tensions: [] as CommercialTension[],
      };
    try {
      const source = commercialOfferValidationSource(v.choice, selectedPages);
      if (
        JSON.stringify(source.sourceFields) !==
          JSON.stringify(v.sourceFields) ||
        JSON.stringify(source.evidence) !== JSON.stringify(v.evidence)
      )
        return {
          status: "SOURCE_UNAVAILABLE" as const,
          ruleVersion: COMMERCIAL_TENSION_RULE_VERSION,
          tensions: [] as CommercialTension[],
        };
    } catch {
      return {
        status: "SOURCE_UNAVAILABLE" as const,
        ruleVersion: COMMERCIAL_TENSION_RULE_VERSION,
        tensions: [] as CommercialTension[],
      };
    }
  }
  const tensions: CommercialTension[] = [];
  function add(
    page: CommercialComparisonPage,
    fields: Fields,
    entry: { fields: Fields },
    parent: { fields: Fields },
    label: string,
    operationIndex: number | null,
    itemIndex: number | null,
    offer?: CommercialWeekPlan["offers"][number],
  ) {
    const signals = fields.filter(
      (f) => f.name === "marketSignal" && f.rawValue,
    );
    if (!signals.some((f) => tensionText(f.rawValue!))) return;
    const timeStatus = commercialItemWeekStatus(entry, parent, week);
    if (timeStatus === "OUTSIDE") return;
    const identifierPattern = /^(?:(EAN|ITM8|PLU)\s*[:#-]?\s*)?(\d{1,14})$/i;
    const identifierFields = entry.fields.filter(
      (f) => f.name === "productIdentifier" && f.rawValue,
    );
    const matches = identifierFields.map((f) => {
      const m = f.rawValue!.trim().match(identifierPattern);
      if (
        !m ||
        f.confidence < 0.8 ||
        !f.evidence.some(
          (e) =>
            e.pageNumber === page.pageNumber &&
            "verification" in e &&
            e.verification === "TEXT_SUPPORTED" &&
            new RegExp(`(^|[^0-9])${m[2]}([^0-9]|$)`).test(e.quote),
        )
      )
        return [];
      return [
        ...new Set(
          input.identifiers
            .filter(
              (i) =>
                i.storeId === plan.storeId &&
                i.status === "VALIDATED" &&
                i.syncState === "SYNCED" &&
                !i.deletedAt &&
                i.value === m[2] &&
                (!m[1] || i.type === m[1].toUpperCase()),
            )
            .map((i) => i.productId),
        ),
      ];
    });
    const unique = [...new Set(matches.flat())];
    const exact =
      matches.length > 0 &&
      matches.every((m) => m.length === 1) &&
      unique.length === 1;
    const productId = offer?.productId ?? (exact ? unique[0]! : null);
    let reason: CommercialTension["reason"] = null;
    if (signals.some((f) => !tensionText(f.rawValue!)))
      reason = "CONFLICTING_SIGNAL";
    else if (
      signals.some(
        (f) =>
          f.confidence < 0.8 ||
          !f.evidence.some(
            (e) => e.pageNumber === page.pageNumber && tensionText(e.quote),
          ),
      )
    )
      reason = "EVIDENCE";
    else if (
      signals.some((f) => {
        const weeks = [
          ...normalized(f.rawValue!).matchAll(
            /\b(?:s(?:emaine)?\s*|semaines?\s*)(\d{1,2})\b/g,
          ),
        ].map((m) => Number(m[1]));
        return weeks.length > 0 && !weeks.includes(week.number);
      })
    )
      reason = "PERIOD";
    else if (timeStatus === "UNKNOWN" && !offer) reason = "PERIOD";
    else if (!productId) reason = "IDENTITY";
    const repeated = tensions.some(
      (t) =>
        t.sourceDocumentId === page.sourceDocumentId &&
        t.readingId === page.id &&
        t.productId === productId &&
        t.status === (reason ? "REVIEW" : "ANNOUNCED") &&
        JSON.stringify(t.signals) === JSON.stringify(signals),
    );
    if (repeated) return;
    tensions.push({
      id: `${plan.revisionId}:${page.id}:${operationIndex ?? "info"}:${itemIndex ?? "operation"}`,
      source: "COMMERCIAL_DOCUMENT",
      productId,
      association: offer
        ? "VALIDATED_OFFER"
        : productId
          ? "EXACT_IDENTIFIER"
          : "UNRESOLVED",
      status: reason ? "REVIEW" : "ANNOUNCED",
      reason,
      label,
      signals,
      sourceDocumentId: page.sourceDocumentId,
      readingId: page.id,
      checksum: page.checksum,
      pageNumber: page.pageNumber,
      operationIndex,
      itemIndex,
      planningWindow: offer
        ? { start: offer.saleStart, end: offer.saleEnd }
        : null,
    });
  }
  for (const page of selectedPages) {
    page.reading!.operations.forEach((op, oi) => {
      op.items.forEach((item, ii) => {
        const offer = plan.offers.find(
          (o) =>
            o.sourceReference.readingId === page.id &&
            o.sourceReference.operationIndex === oi &&
            o.sourceReference.itemIndex === ii,
        );
        add(page, item.fields, item, op, item.label, oi, ii, offer);
      });
      const sole =
        op.items.filter((i) => i.kind === "OFFER").length === 1
          ? plan.offers.find(
              (o) =>
                o.sourceReference.readingId === page.id &&
                o.sourceReference.operationIndex === oi,
            )
          : undefined;
      add(page, op.fields, op, op, op.label, oi, null, sole);
    });
    page.reading!.otherInformation.forEach((item, ii) =>
      add(page, item.fields, item, { fields: [] }, item.label, null, ii),
    );
  }
  return {
    status: "READY" as const,
    ruleVersion: COMMERCIAL_TENSION_RULE_VERSION,
    tensions: tensions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
