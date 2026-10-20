import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import {
  layoutIllustrationQuoteStateSchema,
  sameLayoutIllustrationPreparation,
  type CopilotMessage,
  type LayoutIllustrationPreparation,
  type LayoutIllustrationQuote,
} from "@fl-copilot/domain";
import { InlineAlert, SecondaryButton, PrimaryButton } from "../components/ui";
import { useSync } from "../sync/sync-provider";
import type { LayoutIllustrationGenerationRepository } from "./layout-illustration-generation-repository";
type GenerationState = Awaited<
  ReturnType<LayoutIllustrationGenerationRepository["find"]>
>;
export function LayoutIllustrationGenerationPanel({
  repository,
  quote: requestQuote,
  message,
  preparation,
  deviceId,
  canGenerate,
  current,
  synced,
  onCompleted,
}: {
  repository: Pick<LayoutIllustrationGenerationRepository, "find" | "confirm">;
  quote(preparationId: string): Promise<unknown>;
  message: CopilotMessage;
  preparation: LayoutIllustrationPreparation;
  deviceId: string;
  canGenerate: boolean;
  current: boolean;
  synced: boolean;
  onCompleted(id: string): void;
}) {
  const [record, setRecord] = useState<GenerationState>(),
    [quote, setQuote] = useState<LayoutIllustrationQuote>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    epoch = useRef(0),
    working = useRef(false),
    completed = useRef<string | undefined>(undefined),
    abort = useRef<AbortController | undefined>(undefined);
  const { syncNow, lastSyncedAt } = useSync();
  useEffect(() => {
    const e = ++epoch.current;
    setRecord(undefined);
    setQuote(undefined);
    setBusy(false);
    setError(undefined);
    setNotice(undefined);
    working.current = false;
    completed.current = undefined;
    void repository
      .find(message)
      .then((r) => {
        if (e === epoch.current) setRecord(r);
      })
      .catch(() => {
        if (e === epoch.current)
          setError(
            "Le suivi ne peut pas être relu. Vos demandes restent conservées.",
          );
      });
    return () => {
      epoch.current = e + 1;
      abort.current?.abort();
    };
  }, [repository, message]);
  useEffect(() => {
    if (!lastSyncedAt || working.current) return;
    const e = epoch.current;
    void repository
      .find(message)
      .then((r) => {
        if (e === epoch.current) setRecord(r);
      })
      .catch(() => undefined);
  }, [repository, message, lastSyncedAt]);
  useEffect(() => {
    if (
      record?.syncState === "SYNCED" &&
      record.entity.preparationId === preparation.id &&
      record.entity.ownerId === message.ownerId &&
      record.entity.status === "SUCCEEDED" &&
      completed.current !== record.entity.id
    ) {
      completed.current = record.entity.id;
      onCompleted(record.entity.id);
    }
  }, [record, onCompleted, preparation.id, message.ownerId]);
  async function act(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const e = epoch.current;
    try {
      await task();
    } catch {
      if (e === epoch.current)
        setError(
          "La demande n’a pas pu aboutir. Vos données restent conservées ; vérifiez le suivi avant de confirmer à nouveau.",
        );
    } finally {
      if (e === epoch.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function review() {
    const e = epoch.current;
    await act(async () => {
      const state = layoutIllustrationQuoteStateSchema.parse(
        await requestQuote(preparation.id),
      );
      await repository.find(message);
      if (e !== epoch.current) return;
      if (state.state === "DISABLED") {
        setNotice(
          "La génération d’illustrations n’est pas encore activée. Votre préparation et les images existantes restent disponibles.",
        );
        return;
      }
      if (
        !sameLayoutIllustrationPreparation(
          state.quote.body.preparation,
          preparation,
        )
      )
        throw Error("LAYOUT_ILLUSTRATION_SCOPE_INVALID");
      setQuote(state.quote);
    });
  }
  async function confirm() {
    if (!quote || !current || !synced || !canGenerate) return;
    const e = epoch.current,
      q = quote;
    await act(async () => {
      const signal = new AbortController();
      abort.current = signal;
      await repository.confirm(
        message,
        q,
        { id: randomUUID(), deviceId },
        signal.signal,
      );
      if (e !== epoch.current) return;
      setQuote(undefined);
      setRecord(await repository.find(message));
      // A failed network attempt must not turn the committed local decision into a failed save.
      try {
        await syncNow(message.storeId);
        const next = await repository.find(message);
        if (e === epoch.current) setRecord(next);
      } catch {
        if (e === epoch.current)
          setNotice(
            "Demande enregistrée sur cet appareil. Synchronisez-la avant l’expiration de sa confirmation.",
          );
      }
    });
  }
  const active =
    record?.syncState === "PENDING" ||
    (record?.syncState === "SYNCED" &&
      ["QUEUED", "SUBMITTED"].includes(record.entity.status));
  const refusalLabels: { [key: string]: string } = {
    LAYOUT_ILLUSTRATION_QUOTE_EXPIRED:
      "Confirmation expirée · confirmez à nouveau si vous souhaitez cette image",
    LAYOUT_ILLUSTRATION_DISABLED:
      "La génération n’est pas activée · aucune nouvelle image n’a été demandée",
    LAYOUT_ILLUSTRATION_LIMIT_REACHED:
      "La limite de confirmations de la journée est atteinte",
    LAYOUT_ILLUSTRATION_SOURCE_CHANGED:
      "Le plan ou les produits ont changé · revoyez le scénario",
    LAYOUT_ILLUSTRATION_ALREADY_RUNNING:
      "Une génération est déjà en cours pour ce scénario",
    LAYOUT_ILLUSTRATION_QUOTE_USED:
      "Cette confirmation a déjà été utilisée · vérifiez le suivi",
  };
  const status = record
    ? record.syncState === "PENDING"
      ? "Demande enregistrée · À synchroniser"
      : record.syncState !== "SYNCED"
        ? (refusalLabels[record.refusalCode ?? ""] ??
          "Demande à vérifier dans la synchronisation")
        : record.entity.status === "QUEUED"
          ? "Illustration en attente du traitement"
          : record.entity.status === "SUBMITTED"
            ? "Création de l’illustration en cours"
            : record.entity.status === "SUCCEEDED"
              ? "Illustration disponible"
              : record.entity.status === "NOT_SUBMITTED"
                ? "Génération non démarrée · nouvelle confirmation nécessaire"
                : "Résultat de la génération à vérifier"
    : null;
  return (
    <View className="gap-3">
      {status ? (
        <Text
          accessibilityLiveRegion="polite"
          className="font-semibold text-ink"
        >
          {status}
        </Text>
      ) : null}
      {record?.entity.status === "OUTCOME_UNKNOWN" ? (
        <InlineAlert
          title="Résultat incertain"
          message="L’appel a pu être facturé. La récupération cherche le même original et ne relance pas l’IA. Une nouvelle génération demande votre accord séparément."
        />
      ) : null}
      {quote ? (
        <View className="gap-3 rounded-xl border border-line p-3">
          <Text className="font-semibold text-ink">
            Créer une illustration de ce scénario ?
          </Text>
          <Text className="text-ink">
            Une image PNG · qualité basse · plan v{preparation.physicalVersion}.
            Estimation :{" "}
            {new Intl.NumberFormat("fr-FR", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 6,
            }).format(quote.body.policy.estimatedCostUsdMicros / 1_000_000)}
            .
          </Text>
          <Text className="text-muted">
            L’estimation inclut le traitement du scénario et l’image. Elle
            réserve le budget de l’application ; elle ne constitue pas un
            plafond garanti de facturation du fournisseur. Confirmation valable
            cinq minutes, sans relance automatique de l’IA.
          </Text>
          <PrimaryButton
            label={busy ? "Enregistrement…" : "Confirmer une génération"}
            disabled={busy || !canGenerate || !current || !synced}
            onPress={() => void confirm()}
          />
          <SecondaryButton
            label="Annuler"
            disabled={busy}
            onPress={() => setQuote(undefined)}
          />
        </View>
      ) : active ? (
        <SecondaryButton
          label="Actualiser le suivi"
          disabled={busy}
          onPress={() =>
            void act(async () => {
              const e = epoch.current;
              await syncNow(message.storeId);
              const r = await repository.find(message);
              if (e === epoch.current) setRecord(r);
            })
          }
        />
      ) : canGenerate ? (
        <SecondaryButton
          label={
            record?.entity.status === "SUCCEEDED"
              ? "Créer une autre illustration"
              : "Créer une illustration"
          }
          disabled={busy || !current || !synced || record === undefined}
          onPress={() => void review()}
        />
      ) : null}
      {error ? (
        <SecondaryButton
          label="Relire le suivi"
          disabled={busy}
          onPress={() =>
            void act(async () => {
              const e = epoch.current,
                r = await repository.find(message);
              if (e === epoch.current) setRecord(r);
            })
          }
        />
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" className="text-muted">
          {notice}
        </Text>
      ) : null}
      {error ? (
        <InlineAlert title="Génération à vérifier" message={error} />
      ) : null}
    </View>
  );
}
