import { commercialChoiceSummary } from "./choice-presentation";
import type { LocalCommercialChoice } from "./offer-choice-repository";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router";
import {
  currentCommercialWeek,
  commercialEntryWeekStatus,
  commercialItemWeekStatus,
  commercialDeadlineThisWeek,
  commercialDocumentWeekContext,
  withParentYear,
  commercialChoiceWithinWeek,
} from "@fl-copilot/commercial-core";
import { useState, useCallback } from "react";
import { Text, View, AppState } from "react-native";
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
  choices = [],
}: {
  readings: SynchronizedCommercialVisualReading[];
  choices?: LocalCommercialChoice[];
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [week, setWeek] = useState(() => currentCommercialWeek());
  useFocusEffect(
    useCallback(() => {
      const refresh = () => setWeek(currentCommercialWeek());
      refresh();
      const timer = setInterval(refresh, 60000);
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") refresh();
      });
      return () => {
        clearInterval(timer);
        subscription.remove();
      };
    }, []),
  );
  const ready = readings.filter((r) => r.status === "READY" && r.reading);
  const documentContext = commercialDocumentWeekContext(
    ready.map((page) => page.reading!),
  );
  const allOperations = ready
    .flatMap((page) =>
      page.reading!.operations.map((operation, index) => ({
        operation,
        page,
        key: `${page.id}:${index}`,
        operationIndex: index,
      })),
    )
    .sort(
      (a, b) =>
        ["DRAMAT", "PROSPECTUS", "BASIC", "OTHER"].indexOf(a.operation.kind) -
        ["DRAMAT", "PROSPECTUS", "BASIC", "OTHER"].indexOf(b.operation.kind),
    );
  const operations = allOperations
    .filter(
      ({ operation }) =>
        commercialEntryWeekStatus(operation, week) === "CURRENT",
    )
    .map((entry) => ({
      ...entry,
      operation: {
        ...entry.operation,
        items: entry.operation.items.filter(
          (item) =>
            commercialItemWeekStatus(item, entry.operation, week) === "CURRENT",
        ),
      },
    }));
  const outsideCount = allOperations.length - operations.length;
  const anticipation = allOperations
    .filter(
      ({ operation }) =>
        commercialEntryWeekStatus(operation, week) !== "CURRENT",
    )
    .flatMap(({ operation, page, key }) =>
      operation.items
        .filter((item) =>
          commercialDeadlineThisWeek(withParentYear(item, operation), week),
        )
        .map((item, index) => ({
          label: operation.label,
          page: page.pageNumber,
          key: `${key}:anticipation:${index}`,
          fields: withParentYear(item, operation).fields.filter(
            (f) =>
              f.name === "preorderDeadline" || f.name === "executionDeadline",
          ),
        })),
    );
  const standaloneAnticipation = ready.flatMap((page) =>
    page
      .reading!.otherInformation.filter(
        (item) =>
          commercialEntryWeekStatus(item, week) !== "CURRENT" &&
          commercialDeadlineThisWeek(item, week),
      )
      .map((item, index) => ({
        label: item.label,
        page: page.pageNumber,
        key: `${page.id}:anticipation:${index}`,
        fields: item.fields.filter(
          (f) =>
            f.name === "preorderDeadline" || f.name === "executionDeadline",
        ),
      })),
  );
  const allAnticipation = [...anticipation, ...standaloneAnticipation];
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
        title={`Semaine ${week.number} · ${week.year}`}
        description={`Du ${week.start.split("-").reverse().join("/")} au ${week.end.split("-").reverse().join("/")}`}
      >
        <Text className="text-sm text-muted">
          Seules les offres dont la période concerne cette semaine sont
          présentées. Aucune opération n’est validée pour votre magasin.
          {outsideCount > 0
            ? ` ${outsideCount} dossiers hors période ou sans période fiable ne sont pas affichés. Le PDF original reste complet.`
            : ""}
        </Text>
      </SectionCard>
      <SectionCard
        title="Mes offres retenues"
        description="Vos choix pour cette semaine, disponibles hors connexion. Le choix ne confirme pas une action exécutée."
      >
        {choices.filter(
          (c) =>
            c.entity.status === "RETAINED" &&
            commercialChoiceWithinWeek(c.entity, week),
        ).length === 0 ? (
          <Text className="text-sm text-muted">
            Aucune offre retenue. Choisissez uniquement les offres utiles au
            magasin dans le document ci-dessous.
          </Text>
        ) : null}
        {choices
          .filter(
            (c) =>
              c.entity.status === "RETAINED" &&
              commercialChoiceWithinWeek(c.entity, week),
          )
          .map((choice) => (
            <View key={choice.entity.id} className="gap-2">
              <Text className="text-base text-ink">
                {commercialChoiceSummary(choice.entity)}
              </Text>
              <Text className="text-sm text-muted">
                {choice.syncState === "SYNCED"
                  ? "Synchronisé"
                  : choice.syncState === "CONFLICT"
                    ? "Conflit à comparer"
                    : choice.syncState === "ERROR"
                      ? "Synchronisation à corriger"
                      : "À synchroniser"}
              </Text>
              <SecondaryButton
                label="Consulter mon choix"
                onPress={() =>
                  router.push({
                    pathname: "/commercial-offer/[id]",
                    params: {
                      id: choice.entity.source.readingId,
                      operationIndex: String(
                        choice.entity.source.operationIndex,
                      ),
                      itemIndex: String(choice.entity.source.itemIndex),
                    },
                  })
                }
              />
            </View>
          ))}
      </SectionCard>
      {readings.some((r) => r.status === "FAILED") ? (
        <InlineAlert
          title="Lecture visuelle partielle"
          message="Certaines pages n’ont pas pu être lues visuellement. Le PDF original et les extraits précédents restent disponibles."
        />
      ) : null}
      {operations.map(({ operation, page, key, operationIndex }) => (
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
                {item.kind === "OFFER" ? (
                  <SecondaryButton
                    label={
                      choices.some(
                        (c) =>
                          c.entity.source.readingId === page.id &&
                          c.entity.source.operationIndex === operationIndex &&
                          c.entity.source.itemIndex ===
                            page.reading!.operations[
                              operationIndex
                            ]!.items.indexOf(item) &&
                          c.entity.status === "RETAINED",
                      )
                        ? "Voir mon choix pour cette offre"
                        : "Choisir cette offre pour mon magasin"
                    }
                    onPress={() =>
                      router.push({
                        pathname: "/commercial-offer/[id]",
                        params: {
                          id: page.id,
                          operationIndex: String(operationIndex),
                          itemIndex: String(
                            page.reading!.operations[
                              operationIndex
                            ]!.items.indexOf(item),
                          ),
                        },
                      })
                    }
                  />
                ) : null}

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
        page
          .reading!.tgIdeas.filter(
            (tg) =>
              commercialItemWeekStatus(tg, documentContext, week) === "CURRENT",
          )
          .map((tg, index) => (
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
        page
          .reading!.otherInformation.filter(
            (item) => commercialEntryWeekStatus(item, week) === "CURRENT",
          )
          .map((item, index) => (
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
      {allAnticipation.length ? (
        <SectionCard
          title="À anticiper cette semaine"
          description="Échéances de cette semaine pour des offres futures, distinctes des offres actives."
        >
          {allAnticipation.map((item) => (
            <View key={item.key} className="gap-1">
              <Text className="font-semibold text-ink">{item.label}</Text>
              <Text className="text-sm text-muted">
                Page {item.page} ·{" "}
                {item.fields.map((f) => f.rawValue).join(" · ")}
              </Text>
            </View>
          ))}
        </SectionCard>
      ) : null}
      {!operations.length ? (
        <InlineAlert
          title="Aucune offre datée pour cette semaine"
          message="Le document peut concerner une autre période ou contenir des dates à préciser. Consultez le PDF original ; sa semaine ne remplace pas les dates réelles des offres."
        />
      ) : null}
      {ready
        .filter((page) =>
          operations.some((operation) => operation.page.id === page.id),
        )
        .flatMap((page) =>
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
