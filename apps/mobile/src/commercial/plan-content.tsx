import { Text, View } from "react-native";
import { router } from "expo-router";
import type { CommercialWeekPlan } from "@fl-copilot/sync-contracts";
import { SectionCard, SecondaryButton } from "@/components/ui";
import { commercialMechanismDescription } from "./choice-presentation";
import { CommercialOriginalButton } from "./original-button";
import { formatFrenchCalendarDate } from "@/dates/calendar";
export function CommercialPlanContent({
  plan,
  operationId,
}: {
  plan: CommercialWeekPlan;
  operationId?: string;
}) {
  return (
    <View className="gap-4">
      <Text className="text-base text-muted">
        {formatFrenchCalendarDate(plan.weekStart)} au{" "}
        {formatFrenchCalendarDate(plan.weekEnd)} · {plan.operations.length}{" "}
        opérations · {plan.offers.length} offres ·{" "}
        {plan.preparation.placements.length} TG
      </Text>
      <Text className="text-sm text-muted">
        Ces opérations sont prévues pour le magasin. Aucune exécution n’est
        confirmée par la validation du plan.
      </Text>
      {plan.operations
        .filter((op) => !operationId || op.id === operationId)
        .map((op) => (
          <SectionCard
            key={op.id}
            title={op.name}
            description={`Vente prévue du ${formatFrenchCalendarDate(op.plannedStart)} au ${formatFrenchCalendarDate(op.plannedEnd)}`}
          >
            <Text className="text-sm text-muted">
              {op.operationNature
                .map(
                  (n) =>
                    ({
                      DRAMATIZATION: "Dramat",
                      PROSPECTUS: "Prospectus",
                      COUP_DE_POING: "Coup de poing",
                      SUPPORT_TO_PRODUCTION: "Soutien à la production",
                      SPECIAL_RANGE: "Gamme spécifique",
                      LOCAL_ACTION: "Action locale",
                      OTHER:
                        op.kind === "BASIC"
                          ? "Basique hebdomadaire"
                          : "Autre nature source",
                    })[n],
                )
                .join(" · ")}
            </Text>
            {plan.offers
              .filter((o) => o.operationId === op.id)
              .map((o) => (
                <View key={o.id} className="gap-2">
                  <Text className="font-semibold text-ink">
                    {o.rawProductLabel}
                  </Text>
                  <Text selectable className="text-base text-ink">
                    {commercialMechanismDescription(o.customerMechanism)}
                  </Text>
                  <Text className="text-sm text-muted">
                    Produit associé :{" "}
                    {plan.productRefs.find((p) => p.id === o.productId)
                      ?.label ?? o.rawProductLabel}{" "}
                    · source page {o.sourceReference.pageNumber}
                  </Text>
                  {o.note ? (
                    <Text selectable className="text-sm text-muted">
                      Note magasin : {o.note}
                    </Text>
                  ) : null}
                  <SecondaryButton
                    label="Revoir le choix actuel de cette offre"
                    onPress={() =>
                      router.push({
                        pathname: "/commercial-offer/[id]",
                        params: {
                          id: o.sourceReference.readingId,
                          operationIndex: String(
                            o.sourceReference.operationIndex,
                          ),
                          itemIndex: String(o.sourceReference.itemIndex),
                        },
                      })
                    }
                  />
                </View>
              ))}
            <CommercialOriginalButton sourceDocumentId={op.sourceDocumentId} />
            {!operationId ? (
              <SecondaryButton
                label="Ouvrir l’opération et ses rappels"
                onPress={() =>
                  router.push({
                    pathname: "/commercial-operation/[id]",
                    params: {
                      id: op.id,
                      weekStart: plan.weekStart,
                      reminderRevision: plan.revisionId,
                    },
                  })
                }
              />
            ) : null}
          </SectionCard>
        ))}
      {!operationId ? (
        <SectionCard title="TG prévues">
          {plan.preparation.placements.length ? (
            plan.preparation.placements.map((t) => (
              <View key={t.id} className="gap-1">
                <Text className="font-semibold text-ink">
                  {t.label}
                  {t.theme ? ` · ${t.theme}` : ""}
                </Text>
                <Text className="text-base text-ink">
                  {plan.offers
                    .filter((o) => t.offerIds.includes(o.choiceId))
                    .map((o) => o.rawProductLabel)
                    .join(" · ")}
                </Text>
              </View>
            ))
          ) : (
            <Text className="text-muted">Aucune TG prévue dans ce plan.</Text>
          )}
          <Text className="text-sm text-muted">
            Capacité déclarée :{" "}
            {plan.preparation.tgCapacity ??
              "non précisée, sans emplacement prévu"}
          </Text>
        </SectionCard>
      ) : null}
    </View>
  );
}
