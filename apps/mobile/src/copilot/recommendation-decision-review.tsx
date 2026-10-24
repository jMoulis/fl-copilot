import { useCallback, useMemo, useState } from "react";
import { Text, Switch, View } from "react-native";
import { useSync } from "@/sync/sync-provider";
import { InlineAlert, SecondaryButton, SectionCard } from "@/components/ui";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import { ChoiceSummary } from "./decision-choice-summary";
import type { CopilotDecisionRepository } from "./decision-repository";
import type { CopilotMessage } from "@fl-copilot/domain";
export function RecommendationDecisionReview({
  message,
  repository,
  canConfirm,
  onResolved,
}: {
  message: CopilotMessage;
  repository: CopilotDecisionRepository;
  canConfirm: boolean;
  onResolved: () => void | Promise<void>;
}) {
  const { syncNow } = useSync(),
    scope = useMemo(
      () => ({ repository, messageId: message.id, canConfirm }),
      [repository, message.id, canConfirm],
    ),
    read = useCallback(() => repository.open(message), [repository, message]),
    [completion, setCompletion] = useState<object | null>(null),
    completed = completion === scope;
  const {
    review,
    reading,
    compared,
    setCompared,
    busy,
    error,
    resolve,
    reload,
  } = useReviewedConflict({
    scope,
    read,
    canChoose: (r, local) =>
      canConfirm && !completed && r.canResolve && (!local || r.canRetainLocal),
    choose: async (r, local, lifetime) => {
      await repository.resolve(
        message,
        local,
        r.review,
        lifetime.signal,
        lifetime.canResolve,
      );
    },
    errorText: () =>
      "La comparaison a changé ou votre accès n’est plus disponible. Vos choix restent conservés. Relisez-les avant de décider.",
    onSuccess: () => {
      setCompletion(scope);
      const refresh = () => {
        try {
          void Promise.resolve(onResolved()).catch(() => undefined);
        } catch {
          /* A later focus can read the committed choice. */
        }
      };
      refresh();
      void syncNow(message.storeId)
        .then(refresh)
        .catch(() => undefined);
    },
  });
  return (
    <>
      {reading ? (
        <Text className="text-muted" accessibilityLiveRegion="polite">
          Lecture de la comparaison…
        </Text>
      ) : null}
      <SectionCard title="Votre choix local">
        {review?.decision ? (
          <ChoiceSummary value={review.decision.revisions.at(-1)!} />
        ) : (
          <Text className="text-muted">Lecture du choix local…</Text>
        )}
      </SectionCard>
      <SectionCard title="Choix synchronisé">
        {review?.remote ? (
          <ChoiceSummary value={review.remote.revisions.at(-1)!} />
        ) : (
          <Text className="text-muted">Version synchronisée non vérifiée.</Text>
        )}
      </SectionCard>
      {(review?.group.conflicts.length ?? 0) > 1 ? (
        <Text className="text-muted">
          {review!.group.conflicts.length} conflits concernent ce conseil. La
          comparaison utilise votre choix actuel et la version synchronisée v
          {review?.remote?.version}. Les précédents restent conservés.
        </Text>
      ) : null}
      <Text className="text-muted">
        Conserver votre choix ajoute une décision explicite à l’historique
        synchronisé. Cela ne déclare aucune action réalisée en rayon.
      </Text>
      {review && !review.canRetainLocal ? (
        <Text className="text-muted">
          {review.retentionIssue === "POSTPONE_DATE_PASSED"
            ? "La date du report local est passée. Reprenez le choix synchronisé avant de saisir une nouvelle date."
            : review.retentionIssue === "HISTORY_LIMIT"
              ? "L’historique synchronisé a atteint sa limite ; il peut être repris sans ajouter un choix."
              : "Le conseil d’origine n’est plus actif : seul le choix synchronisé peut être repris."}
        </Text>
      ) : null}
      {completed ? (
        <InlineAlert
          title="Comparaison enregistrée"
          message="Votre choix est conservé sur cet appareil. L’envoi éventuel peut rester à synchroniser."
        />
      ) : (
        <>
          {review?.resolutionIssue ? (
            <InlineAlert
              title="Comparaison à revoir"
              message={review.resolutionIssue}
            />
          ) : null}
          {error ? (
            <InlineAlert title="Résolution impossible" message={error} />
          ) : null}
          <View className="flex-row items-center gap-3">
            <Switch
              accessibilityLabel="J’ai comparé les décisions locale et synchronisée"
              value={compared}
              disabled={
                busy || reading || !!error || !canConfirm || !review?.canResolve
              }
              onValueChange={setCompared}
            />
            <Text className="flex-1 text-ink">
              J’ai comparé les décisions locale et synchronisée.
            </Text>
          </View>
          <SecondaryButton
            label="Conserver ma version locale"
            disabled={
              busy ||
              reading ||
              !!error ||
              !compared ||
              !canConfirm ||
              !review?.canResolve ||
              !review.canRetainLocal
            }
            onPress={() => void resolve(true)}
          />
          <SecondaryButton
            label="Adopter la version synchronisée"
            disabled={
              busy ||
              reading ||
              !!error ||
              !compared ||
              !canConfirm ||
              !review?.canResolve
            }
            onPress={() => void resolve(false)}
          />
          <SecondaryButton
            label="Relire la comparaison"
            disabled={busy || reading}
            onPress={reload}
          />
        </>
      )}
    </>
  );
}
