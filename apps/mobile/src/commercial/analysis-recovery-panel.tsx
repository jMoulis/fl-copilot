import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ApiClient } from "@fl-copilot/api-client";
import type { CommercialProcessingReview } from "@fl-copilot/sync-contracts";
import { useAuth } from "../auth/auth-provider";
import { useSync } from "../sync/sync-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { getApiBaseUrl } from "../config/environment";
import { InlineAlert, SecondaryButton } from "../components/ui";
import { CommercialAnalysisRecoveryRepository } from "../documents/commercial-analysis-recovery";
export function CommercialAnalysisRecoveryPanel({
  sourceDocumentId,
}: {
  sourceDocumentId: string;
}) {
  const { session, withAccessToken } = useAuth(),
    { sqlite } = useLocalDatabase(),
    { syncNow } = useSync();
  const store = session?.stores[0],
    ownerId = session?.user.id;
  if (!store || !ownerId) return null;
  return (
    <AnalysisState
      key={`${store.storeId}/${ownerId}/${sourceDocumentId}`}
      db={sqlite}
      storeId={store.storeId}
      ownerId={ownerId}
      id={sourceDocumentId}
      canResume={store.role === "MANAGER"}
      read={async () =>
        withAccessToken((token) =>
          new ApiClient(getApiBaseUrl()).commercialProcessing(
            token,
            store.storeId,
            sourceDocumentId,
          ),
        )
      }
      sync={() => syncNow(store.storeId)}
    />
  );
}
function AnalysisState({
  db,
  storeId,
  ownerId,
  id,
  canResume,
  read,
  sync,
}: {
  db: ConstructorParameters<typeof CommercialAnalysisRecoveryRepository>[0];
  storeId: string;
  ownerId: string;
  id: string;
  canResume: boolean;
  read(): Promise<CommercialProcessingReview>;
  sync(): Promise<unknown>;
}) {
  const repo = useMemo(
    () => new CommercialAnalysisRecoveryRepository(db, randomUUID),
    [db],
  );
  const [expanded, setExpanded] = useState(false),
    [review, setReview] = useState<CommercialProcessingReview | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>();
  const revision = useRef(0),
    focused = useRef(false),
    locked = useRef(false),
    allowed = useRef(canResume),
    abort = useRef<AbortController | undefined>(undefined);
  allowed.current = canResume;
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const version = ++revision.current;
      if (!locked.current) setBusy(false);
      void repo
        .cached(storeId, id)
        .then((value) => {
          if (revision.current === version) setReview(value);
        })
        .catch((error: unknown) => {
          if (revision.current !== version) return;
          if (
            error instanceof Error &&
            error.message === "COMMERCIAL_ANALYSIS_SOURCE_UNAVAILABLE"
          )
            setNotice(
              "Le PDF doit finir son envoi avant le suivi de l’analyse.",
            );
          else setError("Le dernier état enregistré ne peut pas être lu.");
        });
      return () => {
        focused.current = false;
        revision.current++;
        abort.current?.abort();
      };
    }, [repo, storeId, id]),
  );
  const refresh = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setExpanded(true);
    setError(undefined);
    setNotice(undefined);
    const version = revision.current;
    try {
      await repo.cached(storeId, id);
      const fresh = await read();
      if (revision.current !== version) return;
      await repo.save(storeId, id, fresh);
      const saved = await repo.cached(storeId, id);
      if (revision.current === version) setReview(saved);
    } catch (error) {
      if (
        revision.current === version &&
        error instanceof Error &&
        error.message === "COMMERCIAL_ANALYSIS_SOURCE_UNAVAILABLE"
      )
        setNotice("Le PDF doit finir son envoi avant le suivi de l’analyse.");
      else if (revision.current === version)
        setError(
          "L’actualisation est indisponible. Le dernier état enregistré reste consultable ; réessayez avec la connexion.",
        );
    } finally {
      locked.current = false;
      if (focused.current) setBusy(false);
    }
  };
  const resume = async () => {
    if (locked.current || !allowed.current || !review?.canResume) return;
    const version = revision.current,
      cancellation = new AbortController();
    locked.current = true;
    abort.current = cancellation;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await repo.queue(storeId, ownerId, id, review.basisHash, {
        canResume: () => allowed.current,
        signal: cancellation.signal,
      });
      if (revision.current !== version) return;
      setNotice(
        result.queued
          ? "Demande de reprise enregistrée sur cet appareil. Elle attend le service ; les résultats déjà reçus sont conservés."
          : "Cette demande est déjà enregistrée. Actualisez l’état pour suivre l’analyse.",
      );
      await sync();
      const latest = await repo.latest(storeId, ownerId, id);
      if (revision.current === version && latest?.status === "COMPLETED")
        setNotice(
          "Demande transmise au service. L’analyse peut encore être en attente ; actualisez son état pour suivre les résultats.",
        );
      else if (revision.current === version && latest?.status === "FAILED")
        setError(
          "La reprise n’a pas été acceptée. Actualisez l’état avant une nouvelle demande ; les résultats reçus restent conservés.",
        );
    } catch {
      if (revision.current === version)
        setError(
          "L’état ou vos droits ont changé. Actualisez l’analyse avant de demander sa reprise.",
        );
    } finally {
      locked.current = false;
      if (focused.current) setBusy(false);
    }
  };
  return (
    <View className="gap-3">
      <SecondaryButton
        label={expanded ? "Actualiser l’état de l’analyse" : "Suivre l’analyse"}
        disabled={busy}
        onPress={() => void refresh()}
      />
      {expanded && review ? (
        <View className="gap-2">
          <Text className="text-sm text-muted">
            Dernier état connu :{" "}
            {new Date(review.observedAt).toLocaleString("fr-FR")}
          </Text>
          <Text className="text-sm text-ink">{review.messageFr}</Text>
          {review.stages
            .filter((stage) => stage.kind !== "AI")
            .map((stage) => (
              <Text key={stage.kind} className="text-sm text-muted">
                {labels[stage.kind]} : {stageLabels[stage.state]}
                {stage.totalPages
                  ? ` · ${stage.readyPages}/${stage.totalPages} pages`
                  : ""}
              </Text>
            ))}
          {review.notBefore && !review.canResume ? (
            <Text className="text-sm text-muted">
              Nouvelle tentative possible après le{" "}
              {new Date(review.notBefore).toLocaleString("fr-FR")}.
            </Text>
          ) : null}
          {review.canResume && canResume ? (
            <SecondaryButton
              label="Reprendre les étapes interrompues"
              disabled={busy}
              onPress={() => void resume()}
            />
          ) : null}
        </View>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-forest">
          {notice}
        </Text>
      ) : null}
      {error ? (
        <InlineAlert title="Suivi de l’analyse" message={error} />
      ) : null}
    </View>
  );
}
const labels = {
  TEXT: "Lecture du PDF",
  AI: "Analyse des offres",
  VISUAL: "Lecture des visuels",
};
const stageLabels = {
  WAITING: "En attente",
  RUNNING: "En cours",
  PARTIAL: "Résultats partiels",
  READY: "Résultats reçus",
  BLOCKED: "À vérifier",
  UNAVAILABLE: "Indisponible",
};
