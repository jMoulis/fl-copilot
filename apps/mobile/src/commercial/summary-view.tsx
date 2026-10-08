import type { CommercialReviewDecision } from "@fl-copilot/sync-contracts";
import { useState } from "react";
import { Text, View } from "react-native";
import type {
  buildCommercialDocumentSummary,
  SummaryItem,
  SummarySection,
  SummaryQuestion,
} from "@fl-copilot/commercial-core";
import {
  SectionCard,
  PrimaryButton,
  SecondaryButton,
  InlineAlert,
} from "@/components/ui";
import {
  commercialFieldLabels,
  commercialKindLabels,
  commercialWarningMessage,
} from "./review-presentation";
const sectionLabels: Record<SummarySection, string> = {
  DRAMAT: "Dramat",
  PROSPECTUS: "Prospectus",
  TG: "Idées de TG de l’enseigne",
  BASICS: "Basiques : prix dégressifs et lots",
  OTHER_OPERATIONS: "Autres opérations",
  OFFERS: "Offres à consulter",
  DEADLINES: "Précommandes et livraisons",
  INFORMATION: "Consignes et informations",
};
function briefFields(item: SummaryItem) {
  const wanted =
    item.block.kind === "OFFER"
      ? [
          "productLabel",
          "sellingPrice",
          "customerMechanism",
          "saleStart",
          "saleEnd",
        ]
      : [
          "theme",
          "saleStart",
          "saleEnd",
          "preorderDeadline",
          "deliveryStart",
          "deliveryEnd",
          "instruction",
        ];
  return item.block.fields
    .filter(
      (f) =>
        wanted.includes(f.name) &&
        f.rawValue !== null &&
        f.rawValue !== item.block.label,
    )
    .slice(0, 4);
}
function questionLabel(question: SummaryQuestion) {
  if (question.reason === "DATE_YEAR") return "Année des dates à préciser";
  if (question.reason === "SOURCE_FIELD")
    return `${commercialFieldLabels[question.fieldName ?? ""] ?? "Information"} à vérifier`;
  if (question.reason === "OFFER_CONFLICT")
    return "Variantes d’une offre à comparer";
  if (question.reason === "SYNC_CONFLICT")
    return "Choix d’examen à réconcilier";
  if (question.fieldName === "UNCERTAIN_APPLICABILITY")
    return "Conditions d’application au magasin";
  if (question.fieldName === "UNSUPPORTED_BLOCK")
    return "Extraits non retenus par les contrôles source";
  return commercialWarningMessage(question.fieldName ?? "OTHER");
}
export function CommercialSummaryView({
  summary,
  busy,
  decisions,
  onOpen,
  onConfirmReadable,
}: {
  summary: ReturnType<typeof buildCommercialDocumentSummary>;
  busy: boolean;
  decisions: Array<{ decision: CommercialReviewDecision; state: string }>;
  onOpen: (key: string) => void;
  onConfirmReadable: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    DRAMAT: true,
    PROSPECTUS: true,
    TG: true,
    BASICS: true,
  });
  const [limits, setLimits] = useState<Record<string, number>>({});
  const sections = summary.sections.filter((s) => s.key !== "OFFERS");
  const offers = summary.items.filter((i) => i.block.kind === "OFFER");
  function rows(items: SummaryItem[]) {
    return items.map((item) => (
      <View
        key={item.key}
        className="gap-2 rounded-2xl border border-line bg-canvas p-4"
      >
        <Text
          accessibilityRole="header"
          className="text-base font-semibold text-ink"
        >
          {item.block.label}
        </Text>
        <Text className="text-sm text-muted">
          {commercialKindLabels[item.block.kind]} · page {item.page.pageNumber}
        </Text>
        {briefFields(item).map((field, i) => (
          <Text key={i} selectable className="text-base text-ink">
            {commercialFieldLabels[field.name]} : {field.rawValue}
          </Text>
        ))}
        {decisions
          .filter(
            (choice) =>
              choice.decision.pageId === item.page.id &&
              choice.decision.sourceBlockIndex === item.block.sourceBlockIndex,
          )
          .map((choice) => (
            <View key={choice.decision.id} className="gap-1">
              <Text className="text-sm font-semibold text-forest">
                {choice.decision.decision === "DISMISSED"
                  ? "Écarté de l’examen"
                  : "Transcription examinée"}
                {choice.state === "SYNCED"
                  ? " · synchronisé"
                  : choice.state === "CONFLICT"
                    ? " · conflit"
                    : choice.state === "FAILED"
                      ? " · envoi en erreur"
                      : " · à synchroniser"}
              </Text>
              {choice.decision.corrections.map((c) => (
                <Text key={c.name} className="text-sm text-ink">
                  Correction saisie — {commercialFieldLabels[c.name]} :{" "}
                  {c.value ?? "Valeur retirée"}
                </Text>
              ))}
            </View>
          ))}
        <SecondaryButton
          label="Consulter la source et les détails"
          disabled={busy}
          onPress={() => onOpen(item.key)}
        />
      </View>
    ));
  }
  return (
    <>
      <SectionCard
        title="Préparer la semaine"
        description={`${summary.sourcePages} pages analysées · ${summary.offerCount} offres extraites · ${summary.tgCount} idées de TG repérées`}
      >
        <Text className="text-base text-ink">
          Commencez par les Dramat et le prospectus, puis les TG et les basiques
          hebdomadaires.
        </Text>
        <Text className="text-sm leading-5 text-muted">
          Ces propositions viennent du document de l’enseigne. Consulter les
          consignes ne demande pas de confirmer chaque extrait. Aucune offre ni
          TG n’est encore sélectionnée pour votre magasin.
        </Text>
      </SectionCard>
      {sections.map((section) => {
        const primary =
          section.key === "DRAMAT" ||
          section.key === "PROSPECTUS" ||
          section.key === "TG";
        if (!section.items.length && !primary) return null;
        const pages = [
          ...new Set(section.items.map((i) => i.page.pageNumber)),
        ].sort((a, b) => a - b);
        const pageOffers = summary.items.filter(
          (i) => i.block.kind === "OFFER" && pages.includes(i.page.pageNumber),
        );
        const visible = section.items.slice(
          0,
          expanded[section.key] ? (limits[section.key] ?? 6) : 0,
        );
        return (
          <SectionCard
            key={section.key}
            title={sectionLabels[section.key]}
            description={`${section.items.length} ${section.key === "TG" ? "idées repérées dans le document" : "extraits regroupés"}`}
          >
            {!section.items.length ? (
              <Text className="text-sm text-muted">
                Cette rubrique n’a pas été explicitement identifiée. Consultez
                les autres offres et la source ; aucune rubrique n’a été
                inventée.
              </Text>
            ) : null}
            {section.key === "TG" ? (
              <Text className="text-sm text-muted">
                Idées de l’enseigne, à adapter à vos emplacements disponibles.
                Leur affichage ne signifie pas qu’elles sont retenues.
              </Text>
            ) : null}
            {rows(visible)}
            {expanded[section.key] && visible.length < section.items.length ? (
              <SecondaryButton
                label={`Afficher les ${Math.min(10, section.items.length - visible.length)} extraits suivants`}
                disabled={busy}
                onPress={() =>
                  setLimits((old) => ({
                    ...old,
                    [section.key]: (old[section.key] ?? 6) + 10,
                  }))
                }
              />
            ) : null}
            {section.items.length ? (
              <SecondaryButton
                label={
                  expanded[section.key]
                    ? "Réduire cette rubrique"
                    : `Consulter les ${section.items.length} extraits`
                }
                disabled={busy}
                onPress={() =>
                  setExpanded((old) => ({
                    ...old,
                    [section.key]: !old[section.key],
                  }))
                }
              />
            ) : null}
            {(section.key === "DRAMAT" || section.key === "PROSPECTUS") &&
            pageOffers.length ? (
              <SecondaryButton
                label={
                  expanded[`${section.key}-OFFERS`]
                    ? "Masquer les offres de ces pages"
                    : `Voir les ${pageOffers.length} offres extraites sur les pages ${pages.join(", ")}`
                }
                disabled={busy}
                onPress={() => {
                  setExpanded((old) => ({
                    ...old,
                    [`${section.key}-OFFERS`]: !old[`${section.key}-OFFERS`],
                  }));
                }}
              />
            ) : null}
            {(section.key === "DRAMAT" || section.key === "PROSPECTUS") &&
            pageOffers.length ? (
              <Text className="text-sm text-muted">
                La proximité sur une page ne suffit pas à rattacher une offre à
                l’opération : les associations restent à vérifier.
              </Text>
            ) : null}
            {expanded[`${section.key}-OFFERS`]
              ? rows(pageOffers.slice(0, limits[`${section.key}-OFFERS`] ?? 6))
              : null}
            {expanded[`${section.key}-OFFERS`] &&
            pageOffers.length > (limits[`${section.key}-OFFERS`] ?? 6) ? (
              <SecondaryButton
                label="Afficher les offres suivantes de ces pages"
                disabled={busy}
                onPress={() =>
                  setLimits((old) => ({
                    ...old,
                    [`${section.key}-OFFERS`]:
                      (old[`${section.key}-OFFERS`] ?? 6) + 10,
                  }))
                }
              />
            ) : null}
          </SectionCard>
        );
      })}
      <SectionCard
        title="Catalogue des offres extraites"
        description={`${offers.length} offres consultables, sans validation individuelle obligatoire pour lire le document.`}
      >
        {rows(offers.slice(0, expanded.OFFERS ? (limits.OFFERS ?? 10) : 3))}
        {expanded.OFFERS && offers.length > (limits.OFFERS ?? 10) ? (
          <SecondaryButton
            label="Afficher les offres suivantes"
            disabled={busy}
            onPress={() =>
              setLimits((old) => ({ ...old, OFFERS: (old.OFFERS ?? 10) + 10 }))
            }
          />
        ) : null}
        {offers.length > 3 ? (
          <SecondaryButton
            label={
              expanded.OFFERS
                ? "Réduire le catalogue"
                : `Consulter les ${offers.length} offres`
            }
            disabled={busy}
            onPress={() =>
              setExpanded((old) => ({ ...old, OFFERS: !old.OFFERS }))
            }
          />
        ) : null}
      </SectionCard>
      <SectionCard
        title="Points à clarifier pour le plan"
        description={`${summary.questions.length} sujets regroupés. Ils ne sont pas ${summary.items.length} tâches de validation.`}
      >
        {!summary.questions.length ? (
          <Text className="text-sm text-muted">
            Aucun signal regroupé par ces contrôles. L’application au magasin et
            la sélection des offres restent à décider.
          </Text>
        ) : null}
        {summary.questions.map((question) => (
          <View key={question.key} className="gap-2">
            <InlineAlert
              title={questionLabel(question)}
              message={`Signal sur les pages ${question.pageNumbers.join(", ")}. ${question.reason === "DATE_YEAR" ? "Aucune année n’a été déduite automatiquement." : "Vérifiez les références concernées avant de retenir les informations dans un plan."}`}
            />
            {question.itemKeys.length ? (
              <SecondaryButton
                label="Consulter un extrait concerné"
                disabled={busy}
                onPress={() => onOpen(question.itemKeys[0]!)}
              />
            ) : null}
          </View>
        ))}
      </SectionCard>
      {summary.bulkEligible.length ? (
        <SectionCard
          title="Confirmation groupée facultative"
          description={`${Math.min(100, summary.bulkEligible.length)} transcriptions lisibles dans cette série. Les ambiguïtés sont exclues.`}
        >
          <Text className="text-sm text-muted">
            Cette confirmation concerne uniquement la transcription source. Elle
            ne résout pas les points du plan, ne valide aucun produit et ne
            publie aucune offre.
          </Text>
          <PrimaryButton
            label={`Confirmer ces ${Math.min(100, summary.bulkEligible.length)} transcriptions`}
            disabled={busy}
            loading={busy}
            onPress={onConfirmReadable}
          />
        </SectionCard>
      ) : null}
    </>
  );
}
