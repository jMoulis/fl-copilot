import { useCallback, useMemo, useState } from "react";
import { Switch, Text, View } from "react-native";
import { router } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { InlineAlert, SecondaryButton, SectionCard } from "@/components/ui";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import { CommercialReviewRepository } from "./review-repository";
import { commercialFieldLabels } from "./review-presentation";
import { CommercialOriginalButton } from "./original-button";
import type { CommercialReviewDecision } from "@fl-copilot/sync-contracts";
const digest = (value: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
export function transcriptionConflictError(reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  if (code.includes("SOURCE_CHANGED"))
    return "La comparaison a changé. Relisez les choix avant de confirmer ; vos corrections sont conservées.";
  if (code.includes("AUTHORITY_CHANGED"))
    return "Le compte, le magasin ou le contexte a changé. Rouvrez cette transcription pour reprendre.";
  return "Le choix n’a pas pu être appliqué. Les deux transcriptions restent conservées ; relisez la comparaison.";
}
export function CommercialTranscriptionConflict({
  storeId,
  localId,
  onResolved,
}: {
  storeId: string;
  localId: string;
  onResolved?: () => void;
}) {
  const { session } = useAuth(),
    store = session?.stores[0],
    { deviceId } = useLocalDatabase();
  return session && store?.storeId === storeId ? (
    <TranscriptionReview
      key={`${session.user.id}:${storeId}:${store.role}:${deviceId}:${localId}`}
      storeId={storeId}
      localId={localId}
      actorId={session.user.id}
      role={store.role}
      onResolved={onResolved}
    />
  ) : (
    <InlineAlert
      title="Magasin différent"
      message="Ouvrez cette transcription depuis le magasin auquel le document appartient."
    />
  );
}
function TranscriptionChoice({
  decision,
}: {
  decision: CommercialReviewDecision;
}) {
  return (
    <>
      <Text className="font-semibold text-ink">
        {decision.decision === "DISMISSED"
          ? "Élément écarté"
          : "Transcription confirmée"}
      </Text>
      {decision.corrections.length ? (
        decision.corrections.map((c) => (
          <Text key={c.name} selectable className="text-ink">
            {commercialFieldLabels[c.name] ?? c.name} :{" "}
            {c.value ?? "Valeur retirée"}
          </Text>
        ))
      ) : (
        <Text className="text-muted">Aucune correction de champ.</Text>
      )}
      <Text className="text-sm text-muted">
        Choix enregistré le{" "}
        {new Date(decision.reviewedAt).toLocaleString("fr-FR")}
      </Text>
    </>
  );
}
function TranscriptionReview({
  storeId,
  localId,
  actorId,
  role,
  onResolved,
}: {
  storeId: string;
  localId: string;
  actorId: string;
  role: string;
  onResolved?: () => void;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repository = useMemo(
      () => new CommercialReviewRepository(sqlite, digest),
      [sqlite],
    ),
    scope = useMemo(
      () => ({ repository, deviceId, storeId, localId, actorId, role }),
      [repository, deviceId, storeId, localId, actorId, role],
    ),
    read = useCallback(
      () => repository.reviewConflict(storeId, localId, actorId),
      [repository, storeId, localId, actorId],
    );
  const [completed, setCompleted] = useState(false);
  const {
    review,
    compared,
    setCompared,
    busy,
    reading,
    error,
    resolve,
    reload,
  } = useReviewedConflict({
    scope,
    read,
    canChoose: (r, useLocal) => !useLocal && r.canResolve,
    choose: async (r, _local, lifetime) => {
      if (!r.remote) throw Error("COMMERCIAL_REVIEW_RESOLUTION_INVALID");
      await repository.useRemoteDecision(storeId, localId, r.remote.id, {
        actorId,
        deviceId,
        actionId: randomUUID(),
        reviewHash: r.hash,
        ...lifetime,
      });
    },
    errorText: transcriptionConflictError,
    onSuccess: () => {
      setCompleted(true);
      if (onResolved)
        void Promise.resolve()
          .then(onResolved)
          .catch(() => undefined);
      else {
        void Promise.resolve()
          .then(() => syncNow(storeId))
          .catch(() => undefined);
        try {
          router.back();
        } catch {
          /* The immutable adoption is already committed. */
        }
      }
    },
  });
  return (
    <>
      {reading ? (
        <Text className="text-muted" accessibilityLiveRegion="polite">
          Lecture de la comparaison…
        </Text>
      ) : null}
      {review?.page ? (
        <SectionCard title={`Extrait source · page ${review.page.pageNumber}`}>
          <Text selectable className="text-ink">
            {
              review.page.blocks.find(
                (b) => b.sourceBlockIndex === review.local.sourceBlockIndex,
              )?.label
            }
          </Text>
          <CommercialOriginalButton
            sourceDocumentId={review.page.sourceDocumentId}
          />
        </SectionCard>
      ) : null}
      <SectionCard title="Votre transcription locale">
        {review ? (
          <TranscriptionChoice decision={review.local} />
        ) : (
          <Text className="text-muted">Lecture du choix local…</Text>
        )}
      </SectionCard>
      <SectionCard title="Transcription synchronisée">
        {review?.remote ? (
          <TranscriptionChoice decision={review.remote} />
        ) : (
          <Text className="text-muted">Choix synchronisé non vérifié.</Text>
        )}
      </SectionCard>
      {review && review.group.length > 1 ? (
        <Text className="text-muted">
          {review.group.length} conflits concernent ce même choix. Ils sont
          examinés ensemble.
        </Text>
      ) : null}
      <Text className="text-muted">
        La première transcription acceptée reste la référence de cet extrait.
        Votre choix local et ses corrections restent dans l’historique. Cela ne
        publie aucune offre et ne valide pas son application au magasin.
      </Text>
      {completed ? (
        <InlineAlert
          title="Comparaison enregistrée"
          message="Le choix synchronisé est utilisé. Votre transcription locale reste conservée."
        />
      ) : (
        <>
          {review?.reason ? (
            <InlineAlert title="Comparaison à revoir" message={review.reason} />
          ) : null}
          {error ? (
            <InlineAlert title="Résolution impossible" message={error} />
          ) : null}
          <View className="flex-row items-center gap-3">
            <Switch
              accessibilityLabel="J’ai comparé les transcriptions locale et synchronisée"
              value={compared}
              disabled={busy || reading || !!error || !review?.canResolve}
              onValueChange={setCompared}
            />
            <Text className="flex-1 text-ink">
              J’ai comparé les deux transcriptions.
            </Text>
          </View>
          <SecondaryButton
            label="Conserver le choix synchronisé"
            disabled={
              busy || reading || !!error || !review?.canResolve || !compared
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
