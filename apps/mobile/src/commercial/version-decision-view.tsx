import { useEffect, useMemo, useState } from "react";
import { Text, TextInput } from "react-native";
import {
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import {
  commercialVersionDecisionId,
  commercialVersionDecisionSummary,
} from "@fl-copilot/commercial-core";
import type { CommercialVersionDecision } from "@fl-copilot/sync-contracts";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import {
  CommercialVersionDecisionRepository,
  type LocalCommercialVersionDecision,
} from "./version-decision-repository";
import { commercialVersionDecisionError } from "./version-decision-presentation";
export function CommercialVersionDecisionView({
  storeId,
  sources,
  complete,
}: {
  storeId: string;
  sources: Pick<CommercialVersionDecision, "before" | "after">;
  complete: boolean;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const digest = (s: string) =>
    digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
  const repo = useMemo(
    () => new CommercialVersionDecisionRepository(sqlite, digest),
    [sqlite],
  );
  const [saved, setSaved] = useState<LocalCommercialVersionDecision | null>(),
    [note, setNote] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void repo
      .get(storeId, sources.before.documentId, sources.after.documentId)
      .then((d) => {
        if (active) {
          setSaved(d);
          setNote(d?.entity.note ?? "");
        }
      })
      .catch(() => {
        if (active) setError("Le choix enregistré ne peut pas être lu.");
      });
    return () => {
      active = false;
    };
  }, [repo, storeId, sources.before.documentId, sources.after.documentId]);
  const orientationMatches =
    !saved ||
    (saved.entity.before.documentId === sources.before.documentId &&
      saved.entity.after.documentId === sources.after.documentId);
  async function save(preference: CommercialVersionDecision["preference"]) {
    if (
      busy ||
      !confirmed ||
      !complete ||
      saved === undefined ||
      !orientationMatches
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const now = new Date().toISOString();
      const input: CommercialVersionDecision = {
        id:
          saved?.entity.id ??
          (await commercialVersionDecisionId(
            storeId,
            sources.before.documentId,
            sources.after.documentId,
            digest,
          )),
        storeId,
        ...sources,
        preference,
        comparisonReviewed: true,
        note,
        version:
          (saved?.syncState === "ERROR"
            ? (saved.remoteVersion ?? 0)
            : (saved?.entity.version ?? 0)) + 1,
        createdAt: saved?.entity.createdAt ?? now,
        updatedAt: now,
      };
      await repo.save(input, { commandId: randomUUID(), deviceId });
      setSaved(
        await repo.get(
          storeId,
          sources.before.documentId,
          sources.after.documentId,
        ),
      );
      setConfirmed(false);
      void syncNow(storeId)
        .then(async () =>
          setSaved(
            await repo.get(
              storeId,
              sources.before.documentId,
              sources.after.documentId,
            ),
          ),
        )
        .catch(() => undefined);
    } catch (reason) {
      setError(
        commercialVersionDecisionError(
          reason instanceof Error ? reason.message : undefined,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const disabled =
    busy ||
    saved === undefined ||
    !confirmed ||
    !complete ||
    !orientationMatches ||
    saved?.syncState === "CONFLICT";
  return (
    <SectionCard title="Mon choix de référence pour ces deux PDF">
      <Text className="text-base text-muted">
        Ce choix mémorise la référence à utiliser pour examiner cette
        correction. Vos offres retenues et vos TG restent conservés. Il ne
        valide aucune offre ni le plan et ne résout pas les correspondances
        incertaines.
      </Text>
      {saved ? (
        <>
          <Text selectable className="text-base text-ink">
            {commercialVersionDecisionSummary(saved.entity)}
          </Text>
          <Text className="text-sm text-muted">
            {(
              {
                PENDING: "À synchroniser",
                SYNCED: "Synchronisé",
                CONFLICT: "Conflit à résoudre dans Synchronisation",
                ERROR: "Envoi refusé : choix conservé sur cet appareil",
              } as Record<string, string>
            )[saved.syncState] ?? saved.syncState}
          </Text>
        </>
      ) : saved === undefined ? (
        <Text className="text-sm text-muted">Lecture du choix enregistré…</Text>
      ) : null}
      {saved?.syncState === "ERROR" ? (
        <InlineAlert
          title="Envoi refusé"
          message={commercialVersionDecisionError(
            saved.lastErrorCode ?? undefined,
          )}
        />
      ) : null}
      {!orientationMatches ? (
        <InlineAlert
          title="Comparaison déjà enregistrée dans l’autre sens"
          message="Sélectionnez l’ancien et le nouveau PDF dans le même ordre que la décision conservée avant de la modifier."
        />
      ) : null}
      {!complete ? (
        <InlineAlert
          title="Lectures complètes nécessaires"
          message="Attendez la lecture des deux fichiers avant de mémoriser une référence. Une lecture identique du même original ne constitue pas une correction."
        />
      ) : null}
      <TextInput
        accessibilityLabel="Note sur mon choix de référence PDF"
        placeholder="Note facultative sur votre choix"
        value={note}
        editable={!busy}
        onChangeText={setNote}
        multiline
        maxLength={1200}
        className="rounded-xl border border-line bg-surface p-3 text-ink"
      />
      <SecondaryButton
        label={`${confirmed ? "✓ " : ""}J’ai examiné les différences et leurs sources`}
        disabled={busy || !complete}
        onPress={() => setConfirmed((v) => !v)}
      />
      <SecondaryButton
        label={
          busy ? "Enregistrement…" : "Conserver l’ancien PDF comme référence"
        }
        disabled={disabled}
        onPress={() => void save("KEEP_PREVIOUS")}
      />
      <SecondaryButton
        label={
          busy ? "Enregistrement…" : "Préférer le PDF corrigé comme référence"
        }
        disabled={disabled}
        onPress={() => void save("PREFER_NEW")}
      />
      {error ? (
        <InlineAlert title="Choix non enregistré" message={error} />
      ) : null}
    </SectionCard>
  );
}
