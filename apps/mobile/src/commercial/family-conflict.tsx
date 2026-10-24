import { useCallback, useMemo, useState } from "react";
import { Text, View, Switch } from "react-native";
import { router } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import {
  commercialOfferChoiceSchema,
  commercialWeekPreparationSchema,
  commercialWeekPlanSchema,
  commercialVersionDecisionSchema,
  commercialExecutionTaskSchema,
} from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import type { SyncConflict } from "@/sync/conflict-repository";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import type { CommercialConflictKind } from "./conflict-review";
import { CommercialChoiceRepository } from "./offer-choice-repository";
import { CommercialPreparationRepository } from "./week-preparation-repository";
import { CommercialPlanRepository } from "./week-plan-repository";
import { CommercialVersionDecisionRepository } from "./version-decision-repository";
import { CommercialExecutionRepository } from "./execution-repository";
import { commercialChoiceSummary } from "./choice-presentation";
import { commercialPreparationSummary } from "./preparation-presentation";
import { commercialPlanSummary } from "./plan-presentation";
import { commercialExecutionSummary } from "./execution-presentation";
import { CommercialOriginalButton } from "./original-button";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
export function CommercialFamilyConflict({
  kind,
  conflict,
}: {
  kind: CommercialConflictKind;
  conflict: SyncConflict;
}) {
  const { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0];
  return session && store?.storeId === conflict.storeId ? (
    <CommercialFamilyReview
      key={`${session.user.id}:${store.storeId}:${conflict.id}:${kind}:${deviceId}:${store.role}`}
      kind={kind}
      conflict={conflict}
    />
  ) : (
    <InlineAlert
      title="Magasin différent"
      message="Ouvrez ce conflit depuis le magasin auquel appartient la décision commerciale."
    />
  );
}
function CommercialFamilyReview({
  kind,
  conflict,
}: {
  kind: CommercialConflictKind;
  conflict: SyncConflict;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repo = useMemo(() => {
      if (kind === "COMMERCIAL_CHOICE")
        return new CommercialChoiceRepository(sqlite, digest);
      if (kind === "COMMERCIAL_PREPARATION")
        return new CommercialPreparationRepository(sqlite, digest);
      if (kind === "COMMERCIAL_PLAN")
        return new CommercialPlanRepository(sqlite, digest);
      if (kind === "COMMERCIAL_REFERENCE")
        return new CommercialVersionDecisionRepository(sqlite, digest);
      return new CommercialExecutionRepository(sqlite, digest);
    }, [kind, sqlite]),
    scope = useMemo(
      () => ({
        repo,
        deviceId,
        storeId: conflict.storeId,
        conflictId: conflict.id,
      }),
      [repo, deviceId, conflict.storeId, conflict.id],
    ),
    read = useCallback(
      () => repo.review(conflict.storeId, conflict.id),
      [repo, conflict.storeId, conflict.id],
    ),
    [retention, setRetention] = useState<{
      hash: string;
      local: boolean;
    } | null>(null);
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
    canChoose: (r, local) =>
      (local ? r.canKeepLocal : r.canAdoptRemote) &&
      (!(local ? r.policy.retainLocal : r.policy.retainRemote) ||
        (retention?.hash === r.hash && retention.local === local)),
    choose: (r, local, lifetime) => {
      const consent = retention?.hash === r.hash && retention.local === local;
      setRetention(null);
      return repo.resolve(conflict.id, local, {
        storeId: conflict.storeId,
        deviceId,
        commandId: randomUUID(),
        remoteHistoryId: randomUUID(),
        reviewHash: r.hash,
        retainWithdrawn: consent,
        ...lifetime,
      });
    },
    errorText: () =>
      "La comparaison a changé ou votre accès n’est plus disponible. Vos versions sont conservées. Relisez-les avant de décider.",
    onSuccess: () => {
      void syncNow(conflict.storeId).catch(() => undefined);
      router.back();
    },
  });
  const summary = (raw: unknown) => {
      if (kind === "COMMERCIAL_CHOICE") {
        const c = commercialOfferChoiceSchema.parse(raw);
        return `${commercialChoiceSummary(c)}\nProduit associé : ${review?.policy.products[c.productId] ?? "Référence non disponible localement"}${c.note ? `\n${c.note}` : ""}`;
      }
      if (kind === "COMMERCIAL_PREPARATION") {
        const p = commercialWeekPreparationSchema.parse(raw);
        return `${commercialPreparationSummary(p)}${p.note ? `\n${p.note}` : ""}\n${p.offerRefs.map((o) => `${review?.policy.choices[o.choiceId] ?? "Offre non disponible localement"} · version ${o.choiceVersion}`).join("\n")}`;
      }
      if (kind === "COMMERCIAL_PLAN") {
        const p = commercialWeekPlanSchema.parse(raw);
        return `${commercialPlanSummary(p)}${p.preparation.note ? `\n${p.preparation.note}` : ""}`;
      }
      if (kind === "COMMERCIAL_EXECUTION")
        return commercialExecutionSummary(
          commercialExecutionTaskSchema.parse(raw),
        );
      const d = commercialVersionDecisionSchema.parse(raw),
        selected =
          d.preference === "KEEP_PREVIOUS"
            ? d.before.documentId
            : d.after.documentId;
      return `Référence : ${review?.policy.documents[selected] ?? "Document non disponible localement"}${d.note ? `\n${d.note}` : ""}`;
    },
    canChoose = !!review && (review.canKeepLocal || review.canAdoptRemote),
    localSource =
      kind === "COMMERCIAL_CHOICE" && review
        ? commercialOfferChoiceSchema.parse(review.current.entity).source
            .sourceDocumentId
        : null,
    documents =
      kind === "COMMERCIAL_REFERENCE" && review
        ? (() => {
            const d = commercialVersionDecisionSchema.parse(
              review.current.entity,
            );
            return [d.before.documentId, d.after.documentId];
          })()
        : localSource
          ? [localSource]
          : [];
  return (
    <>
      {reading ? (
        <Text className="text-sm text-muted" accessibilityLiveRegion="polite">
          Lecture de la comparaison…
        </Text>
      ) : null}
      <SectionCard title="Votre version locale">
        <Text className="text-ink">
          {review
            ? summary(review.current.entity)
            : "Lecture de la version locale…"}
        </Text>
      </SectionCard>
      <SectionCard title="Version synchronisée">
        <Text className="text-ink">
          {review?.group.remote
            ? summary(review.group.remote)
            : "Version distante non vérifiée."}
        </Text>
      </SectionCard>
      {documents.length ? (
        <SectionCard title="Sources de la comparaison">
          {documents.map((id) => (
            <CommercialOriginalButton
              key={id}
              sourceDocumentId={id}
              label={
                review?.policy.documents[id]
                  ? `Consulter ${review.policy.documents[id]}`
                  : "Consulter le PDF original"
              }
            />
          ))}
        </SectionCard>
      ) : null}
      {(review?.group.conflicts.length ?? 0) > 1 ? (
        <Text className="text-sm text-muted">
          {review!.group.conflicts.length} conflits concernent cette même
          décision. Le choix porte sur votre version actuelle et la version
          synchronisée v{review?.group.remote?.version}. Les versions
          précédentes restent conservées.
        </Text>
      ) : null}
      <Text className="text-muted">
        {kind === "COMMERCIAL_EXECUTION"
          ? "Conserver cette déclaration ne constate pas une nouvelle réalisation et ne la rattache pas à un autre plan."
          : kind === "COMMERCIAL_PLAN"
            ? "Conserver le plan peut reconstruire ses offres et opérations à partir des sources vérifiées. Aucune réalisation physique n’est déclarée."
            : kind === "COMMERCIAL_REFERENCE"
              ? "Le choix conserve le document de référence, même si les versions distantes sont présentées dans un autre ordre. Les PDF originaux restent conservés."
              : "Les sources, décisions et versions précédentes restent conservées. Aucune version n’est choisie automatiquement."}
      </Text>
      {review?.reason ? (
        <InlineAlert
          title={review.ready ? "Choix disponibles" : "Comparaison à revoir"}
          message={review.reason}
        />
      ) : null}
      {error ? (
        <InlineAlert title="Résolution impossible" message={error} />
      ) : null}
      <View className="flex-row items-center gap-3">
        <Switch
          accessibilityLabel="J’ai comparé les versions locale et synchronisée"
          value={compared}
          disabled={busy || reading || !!error || !canChoose}
          onValueChange={(v) => {
            setCompared(v);
            if (!v) setRetention(null);
          }}
        />
        <Text className="flex-1 text-base text-ink">
          J’ai comparé les versions locale et synchronisée.
        </Text>
      </View>
      {([true, false] as const).map((local) => {
        const allowed =
            !!review && (local ? review.canKeepLocal : review.canAdoptRemote),
          required =
            !!review &&
            (local ? review.policy.retainLocal : review.policy.retainRemote),
          consent =
            retention?.hash === review?.hash && retention?.local === local;
        return (
          <View key={String(local)} className="gap-3">
            {allowed && required ? (
              <View className="flex-row items-center gap-3">
                <Switch
                  accessibilityLabel={`Je confirme de retenir l’offre retirée dans la version ${local ? "locale" : "synchronisée"}`}
                  value={!!consent}
                  disabled={busy || reading || !!error || !compared}
                  onValueChange={(v) =>
                    setRetention(
                      v && review ? { hash: review.hash, local } : null,
                    )
                  }
                />
                <Text className="flex-1 text-ink">
                  Je confirme de retenir l’offre retirée dans la version{" "}
                  {local ? "locale" : "synchronisée"}.
                </Text>
              </View>
            ) : null}
            <SecondaryButton
              label={
                local
                  ? "Conserver ma version locale"
                  : "Adopter la version synchronisée"
              }
              disabled={
                busy ||
                reading ||
                !!error ||
                !compared ||
                !allowed ||
                (required && !consent)
              }
              onPress={() => void resolve(local)}
            />
          </View>
        );
      })}
      <SecondaryButton
        label="Relire la comparaison"
        disabled={busy || reading}
        onPress={() => {
          setRetention(null);
          reload();
        }}
      />
    </>
  );
}
