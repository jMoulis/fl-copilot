import { CommercialExecutionConflict } from "@/commercial/execution-conflict";
import { CommercialVersionDecisionConflict } from "@/commercial/version-decision-conflict";
import { CommercialPlanConflict } from "@/commercial/plan-conflict";
import { CommercialPreparationConflict } from "@/commercial/preparation-conflict";
import { CommercialChoiceConflict } from "@/commercial/choice-conflict";
import { commercialReviewDecisionSchema } from "@fl-copilot/sync-contracts";
import { useState } from "react";
import { randomUUID } from "expo-crypto";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { ProductMasterRepository } from "@/products/product-master-repository";
import { Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
  SectionCard,
} from "@/components/ui";
import {
  conflictEntityLabel,
  conflictPayloadSummary,
} from "@/sync/conflict-presentation";
import { useSyncConflict } from "@/sync/use-sync-conflicts";

export default function SyncConflictDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const conflict = useSyncConflict(id);
  const database = useLocalDatabase();
  const { syncNow } = useSync();
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string>();
  const review =
    conflict?.entityType === "commercial_review_decision"
      ? commercialReviewDecisionSchema.safeParse(conflict.localPayload)
      : null;

  return (
    <AppScreen>
      <AppHeader
        title="Conflit de synchronisation"
        subtitle="Comparez les deux versions avant de choisir une résolution sûre."
      />

      {conflict === undefined ? (
        <Text className="text-base text-muted">Chargement du conflit…</Text>
      ) : conflict === null ? (
        <InlineAlert
          title="Conflit indisponible"
          message="Ce conflit n’existe plus ou a déjà été traité."
        />
      ) : (
        <>
          <InlineAlert
            title={conflictEntityLabel(conflict)}
            message="La version de cette donnée a changé pendant la synchronisation. Votre version locale a été conservée."
          />

          {conflict.entityType === "commercial_execution_task" ? (
            <CommercialExecutionConflict conflict={conflict} />
          ) : conflict.entityType === "commercial_week_plan" ? (
            <CommercialPlanConflict conflict={conflict} />
          ) : conflict.entityType === "commercial_version_decision" ? (
            <CommercialVersionDecisionConflict conflict={conflict} />
          ) : conflict.entityType === "commercial_week_preparation" ? (
            <CommercialPreparationConflict conflict={conflict} />
          ) : conflict.entityType === "commercial_offer_choice" ? (
            <CommercialChoiceConflict conflict={conflict} />
          ) : (
            <>
              <SectionCard title="Votre version">
                <Text className="text-base leading-6 text-ink">
                  {conflictPayloadSummary(
                    conflict.localPayload,
                    "Version locale indisponible.",
                  )}
                </Text>
              </SectionCard>

              <SectionCard title="Version synchronisée">
                <Text className="text-base leading-6 text-ink">
                  {conflictPayloadSummary(
                    conflict.remotePayload,
                    "Aucune version distante disponible.",
                  )}
                </Text>
              </SectionCard>
            </>
          )}
          <SectionCard title="Actions autorisées">
            {review?.success ? (
              <SecondaryButton
                label="Comparer dans le document commercial"
                onPress={() =>
                  router.push(
                    `/commercial-review/${review.data.sourceDocumentId}`,
                  )
                }
              />
            ) : null}
            {conflict.entityType === "product_alias" ? (
              <SecondaryButton
                label={
                  resolving ? "Reprise…" : "Reprendre l’annulation du libellé"
                }
                disabled={resolving}
                onPress={() => {
                  setResolving(true);
                  setError(undefined);
                  void new ProductMasterRepository(database.sqlite)
                    .retryWasteAliasDeletion(conflict.id, {
                      commandId: randomUUID(),
                      deviceId: database.deviceId,
                    })
                    .then(async () => {
                      await syncNow(conflict.storeId);
                      router.back();
                    })
                    .catch(() =>
                      setError(
                        "Cette annulation ne peut pas être reprise automatiquement : l’association a changé ou ce conflit ne concerne pas une suppression de libellé de casse. Aucune donnée distante n’a été remplacée.",
                      ),
                    )
                    .finally(() => setResolving(false));
                }}
              />
            ) : null}
            {error ? (
              <InlineAlert title="Résolution impossible" message={error} />
            ) : null}
            <Text className="text-base leading-6 text-muted">
              {conflict.entityType === "commercial_execution_task"
                ? "Comparez les statuts, les notes et la date de déclaration. Les deux versions restent dans l’historique."
                : conflict.entityType === "commercial_week_plan"
                  ? "Le plan et son historique restent conservés. La résolution recontrôle les données avant de retenir un plan local ; aucune exécution n’est confirmée."
                  : conflict.entityType === "commercial_version_decision"
                    ? "Comparez les deux préférences de PDF. La résolution conserve leur historique, vos offres et vos TG."
                    : conflict.entityType === "commercial_week_preparation"
                      ? "La préparation reste un brouillon. Comparez les affectations avant de choisir une version."
                      : conflict.entityType === "commercial_offer_choice"
                        ? "Comparez les deux choix ci-dessus. La résolution conserve leur historique et ne confirme aucune action exécutée."
                        : conflict.entityType === "product_alias"
                          ? "La reprise vérifie que le libellé désigne toujours le même produit avant de renvoyer votre annulation."
                          : "Les choix de résolution seront proposés selon les règles métier de cette donnée. Aucune version ne sera remplacée automatiquement."}
            </Text>
          </SectionCard>
        </>
      )}

      <SecondaryButton label="Retour" onPress={() => router.back()} />
    </AppScreen>
  );
}
