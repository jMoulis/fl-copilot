import { LayoutIllustrationGenerationPanel } from "./layout-illustration-generation-panel";
import type { LayoutIllustrationGenerationRepository } from "./layout-illustration-generation-repository";
import { LayoutIllustrationViewer } from "./layout-illustration-viewer";
import type { LayoutIllustrationTransfer } from "./layout-illustration-transfer";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import type { CopilotMessage } from "@fl-copilot/domain";
import { prepareStoreLayoutIllustration } from "@fl-copilot/commercial-core";
import { InlineAlert, SecondaryButton } from "../components/ui";
import { useSync } from "../sync/sync-provider";
import type { LayoutIllustrationRepository } from "./layout-illustration-repository";
import type { CopilotStoreLayoutScenarioReader } from "./store-layout-scenario-reader";
type State = Awaited<ReturnType<CopilotStoreLayoutScenarioReader["open"]>>;
export function LayoutIllustrationPanel({
  repository,
  generation,
  files,
  message,
  state,
  deviceId,
  canPrepare,
  onOpenPlan,
}: {
  repository: Pick<LayoutIllustrationRepository, "prepare" | "find">;
  generation?: {
    repository: Pick<
      LayoutIllustrationGenerationRepository,
      "find" | "confirm"
    >;
    quote(id: string): Promise<unknown>;
  };
  files?: Pick<
    LayoutIllustrationTransfer,
    "load" | "refresh" | "setOfflineRequired"
  >;
  message: CopilotMessage;
  state: State;
  deviceId: string;
  canPrepare: boolean;
  onOpenPlan(): void;
}) {
  const [record, setRecord] = useState<
      Awaited<ReturnType<LayoutIllustrationRepository["find"]>> | undefined
    >(),
    [imageEpoch, setImageEpoch] = useState(0),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false),
    working = useRef(false),
    active = useRef(0),
    abort = useRef<AbortController | undefined>(undefined);
  const { syncNow, lastSyncedAt } = useSync();
  const source = useMemo(() => {
    try {
      return state.layout
        ? prepareStoreLayoutIllustration(
            message.storeId,
            state.scenario,
            state.layout,
          )
        : null;
    } catch {
      return null;
    }
  }, [message.storeId, state.scenario, state.layout]);
  useEffect(() => {
    const epoch = ++active.current;
    setRecord(undefined);
    setError(undefined);
    setBusy(false);
    working.current = false;
    void repository
      .find(message)
      .then((value) => {
        if (epoch === active.current) setRecord(value);
      })
      .catch(() => {
        if (epoch === active.current)
          setError(
            "La préparation ne peut pas être relue. Vos données restent conservées.",
          );
      });
    return () => {
      active.current = epoch + 1;
      abort.current?.abort();
    };
  }, [repository, message]);
  useEffect(() => {
    if (!lastSyncedAt || working.current) return;
    const epoch = active.current;
    void repository
      .find(message)
      .then((value) => {
        if (epoch === active.current) setRecord(value);
      })
      .catch(() => undefined);
  }, [lastSyncedAt, repository, message]);
  async function reload() {
    const epoch = active.current;
    setError(undefined);
    try {
      const next = await repository.find(message);
      if (epoch === active.current) setRecord(next);
    } catch {
      if (epoch === active.current)
        setError(
          "La préparation ne peut pas être relue. Vos données restent conservées.",
        );
    }
  }
  async function prepare() {
    if (
      !canPrepare ||
      working.current ||
      record ||
      !source ||
      source.status !== "READY" ||
      state.freshness !== "CURRENT"
    )
      return;
    working.current = true;
    setBusy(true);
    setError(undefined);
    const epoch = active.current,
      signal = new AbortController();
    abort.current = signal;
    try {
      await repository.prepare(
        message,
        { id: randomUUID(), commandId: randomUUID(), deviceId },
        signal.signal,
      );
      const next = await repository.find(message);
      if (epoch === active.current) {
        setRecord(next);
        void syncNow(message.storeId)
          .then(() => repository.find(message))
          .then((value) => {
            if (epoch === active.current) setRecord(value);
          })
          .catch(() => undefined);
      }
    } catch {
      if (epoch === active.current)
        setError(
          "La préparation n’a pas pu être enregistrée. Vérifiez les sources du scénario et réessayez ; aucune image n’a été générée.",
        );
    } finally {
      if (epoch === active.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <View className="gap-3 rounded-xl border border-line p-3">
      <Text className="font-semibold text-ink">Illustration</Text>
      {record ? (
        <>
          <Text className="text-ink">
            Préparation enregistrée ·{" "}
            {record.syncState === "SYNCED"
              ? "Synchronisée"
              : record.syncState === "PENDING"
                ? "À synchroniser"
                : "Synchronisation à vérifier"}
          </Text>
          <Text className="text-muted">
            Le plan et les affectations d’origine sont conservés.
          </Text>
          {generation ? (
            <LayoutIllustrationGenerationPanel
              repository={generation.repository}
              quote={generation.quote}
              message={message}
              preparation={record.entity}
              deviceId={deviceId}
              canGenerate={canPrepare}
              current={state.freshness === "CURRENT"}
              synced={record.syncState === "SYNCED"}
              onCompleted={() => {
                const epoch = active.current;
                void files
                  ?.refresh(message)
                  .then(() => {
                    if (epoch === active.current) setImageEpoch((v) => v + 1);
                  })
                  .catch(() => undefined);
              }}
            />
          ) : null}
          {files ? (
            <LayoutIllustrationViewer
              key={imageEpoch}
              transfer={files}
              message={message}
              current={state.freshness === "CURRENT"}
              synced={record.syncState === "SYNCED"}
            />
          ) : null}
        </>
      ) : (
        <>
          <Text className="text-muted">
            Conservez ce scénario pour son illustration. La génération sera
            proposée séparément, avec votre accord.
          </Text>
          {source?.status !== "READY" ? (
            <InlineAlert
              title={
                source?.status === "BLOCKED"
                  ? "Plan à vérifier"
                  : "Mesures à préciser"
              }
              message={
                source?.status === "BLOCKED"
                  ? (source.geometry.issues.find(
                      (i) => i.severity === "BLOCKING",
                    )?.message ??
                    "Une incompatibilité du plan reste à résoudre.")
                  : source?.required.length
                    ? `${source.required.length} élément${source.required.length > 1 ? "s" : ""} du plan ${source.required.length > 1 ? "ont" : "a"} encore une position, une orientation ou des dimensions au sol à renseigner. Ces valeurs ne seront pas déduites d’une image.`
                    : "Vérifiez le plan d’origine et ses contraintes avant de préparer une illustration."
              }
            />
          ) : null}
          {state.freshness !== "CURRENT" ? (
            <Text className="text-muted">
              Vérifiez les sources de cette proposition avant de poursuivre.
            </Text>
          ) : null}
          <SecondaryButton
            label={busy ? "Enregistrement…" : "Préparer l’illustration"}
            onPress={() => void prepare()}
            disabled={
              !canPrepare ||
              busy ||
              record === undefined ||
              !source ||
              source.status !== "READY" ||
              state.freshness !== "CURRENT"
            }
          />
        </>
      )}
      {source?.status !== "READY" ? (
        <SecondaryButton
          label="Ouvrir le plan du magasin"
          onPress={onOpenPlan}
        />
      ) : null}
      {error ? (
        <>
          <InlineAlert title="Préparation indisponible" message={error} />
          <SecondaryButton
            label="Relire la préparation"
            disabled={busy}
            onPress={() => void reload()}
          />
        </>
      ) : null}
    </View>
  );
}
