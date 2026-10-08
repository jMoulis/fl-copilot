import { useState } from "react";
import { Text, View } from "react-native";
import type { SynchronizedCommercialVisualReading } from "@fl-copilot/sync-contracts";
import { SectionCard, InlineAlert, SecondaryButton } from "@/components/ui";
import { commercialFieldLabels } from "./review-presentation";
const extraFieldLabels: Record<string, string> = {
  variety: "Variété",
  origin: "Origine",
  grade: "Catégorie",
  calibre: "Calibre",
  packaging: "Conditionnement",
  announcedFigure: "Chiffre annoncé par le document",
  documentYear: "Année indiquée dans le document",
};
const kinds: Record<string, string> = {
  DRAMAT: "Dramat",
  PROSPECTUS: "Prospectus",
  BASIC: "Basiques hebdomadaires",
  OTHER: "Autre opération",
  OFFER: "Produit et offre",
  INSTRUCTION: "Consigne de l’enseigne",
  COMMUNICATION: "Communication et affiches",
  WINDOW: "Période ou échéance",
  MERCHANDISING: "Mise en avant",
  ANNOUNCED_FIGURE: "Chiffre annoncé dans le document",
};
export function CommercialVisualView({
  readings,
}: {
  readings: SynchronizedCommercialVisualReading[];
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const ready = readings.filter((r) => r.status === "READY" && r.reading);
  const operations = ready
    .flatMap((page) =>
      page.reading!.operations.map((operation, index) => ({
        operation,
        page,
        key: `${page.id}:${index}`,
      })),
    )
    .sort(
      (a, b) =>
        ["DRAMAT", "PROSPECTUS", "BASIC", "OTHER"].indexOf(a.operation.kind) -
        ["DRAMAT", "PROSPECTUS", "BASIC", "OTHER"].indexOf(b.operation.kind),
    );
  function fields(
    items: NonNullable<
      SynchronizedCommercialVisualReading["reading"]
    >["operations"][number]["fields"],
  ) {
    return items.map((f, i) => (
      <View key={i} className="gap-1">
        <Text className="font-semibold text-ink">
          {commercialFieldLabels[f.name] ??
            extraFieldLabels[f.name] ??
            "Information source"}
        </Text>
        <Text selectable className="text-base text-ink">
          {f.rawValue ?? "Non extrait / à préciser"}
        </Text>
        {f.evidence.some((e) => e.verification === "VISUAL_TO_VERIFY") ? (
          <Text className="text-sm text-muted">
            Lecture visuelle proposée : vérifiez dans le PDF original.
          </Text>
        ) : null}
      </View>
    ));
  }
  return (
    <>
      <SectionCard
        title="Lecture du PDF original"
        description={`${ready.length} pages lues visuellement sur ${readings[0]?.pageCount ?? "…"}`}
      >
        <Text className="text-sm text-muted">
          Produits, prix et consignes sont regroupés d’après le document et sa
          mise en page. Les liens restent proposés ; aucune opération n’est
          validée pour votre magasin.
        </Text>
      </SectionCard>
      {readings.some((r) => r.status === "FAILED") ? (
        <InlineAlert
          title="Lecture visuelle partielle"
          message="Certaines pages n’ont pas pu être lues visuellement. Le PDF original et les extraits précédents restent disponibles."
        />
      ) : null}
      {operations.map(({ operation, page, key }) => (
        <SectionCard
          key={key}
          title={`${kinds[operation.kind]} · ${operation.label}`}
          description={`Source : page ${page.pageNumber}`}
        >
          <Text selectable className="text-base leading-6 text-ink">
            {operation.summaryFr}
          </Text>
          {fields(operation.fields)}
          {operation.items
            .slice(0, expanded[key] ? operation.items.length : 5)
            .map((item, index) => (
              <View
                key={index}
                className="gap-3 rounded-2xl border border-line bg-canvas p-4"
              >
                <Text
                  accessibilityRole="header"
                  className="font-semibold text-ink"
                >
                  {kinds[item.kind]} · {item.label}
                </Text>
                {fields(item.fields)}
                <Text selectable className="text-sm text-muted">
                  {item.evidence
                    .map((ref) => `Page ${ref.pageNumber} : ${ref.quote}`)
                    .join("\n")}
                </Text>
              </View>
            ))}
          {operation.items.length > 5 ? (
            <SecondaryButton
              label={
                expanded[key]
                  ? "Réduire le dossier"
                  : `Voir les ${operation.items.length} éléments rattachés`
              }
              onPress={() =>
                setExpanded((old) => ({ ...old, [key]: !old[key] }))
              }
            />
          ) : null}
          <Text selectable className="text-sm text-muted">
            {operation.evidence
              .map((ref) => `Page ${ref.pageNumber} : ${ref.quote}`)
              .join("\n")}
          </Text>
        </SectionCard>
      ))}
      {ready.flatMap((page) =>
        page.reading!.tgIdeas.map((tg, index) => (
          <SectionCard
            key={`${page.id}:tg:${index}`}
            title={`Idée de TG · ${tg.label}`}
            description={`Source : page ${page.pageNumber}, emplacement magasin non sélectionné`}
          >
            {fields(tg.fields)}
            <Text selectable className="text-sm text-muted">
              {tg.evidence.map((ref) => ref.quote).join("\n")}
            </Text>
          </SectionCard>
        )),
      )}
      {ready.flatMap((page) =>
        page.reading!.otherInformation.map((item, index) => (
          <SectionCard
            key={`${page.id}:info:${index}`}
            title={`${kinds[item.kind]} · ${item.label}`}
            description={`Source : page ${page.pageNumber}`}
          >
            {fields(item.fields)}
            <Text selectable className="text-sm text-muted">
              {item.evidence.map((ref) => ref.quote).join("\n")}
            </Text>
          </SectionCard>
        )),
      )}
      {ready.flatMap((page) =>
        page.reading!.warnings.map((warning, index) => (
          <InlineAlert
            key={`${page.id}:warning:${index}`}
            title={`À vérifier · page ${page.pageNumber}`}
            message={warning}
          />
        )),
      )}
    </>
  );
}
