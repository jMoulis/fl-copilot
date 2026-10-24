import { isCatalogueConflictKind } from "@fl-copilot/domain";
import { catalogueConflictSummary } from "../products/conflict-presentation";
import {
  commercialVersionDecisionSchema,
  commercialExecutionTaskSchema,
} from "@fl-copilot/domain";
import { commercialExecutionSummary } from "../commercial/execution-presentation";
import { CommercialOriginalButton } from "../commercial/original-button";
import {
  commercialOfferChoiceSchema,
  commercialWeekPreparationSchema,
  commercialWeekPlanSchema,
} from "@fl-copilot/domain";
import { commercialChoiceSummary } from "../commercial/choice-presentation";
import { commercialPreparationSummary } from "../commercial/preparation-presentation";
import { commercialPlanSummary } from "../commercial/plan-presentation";
import { needUnitSummary } from "../needs/presentation";
import { membershipSummary } from "../needs/membership-presentation";
import { substitutionSummary } from "../needs/substitution-presentation";
import { useCallback, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ActivityIndicator, Pressable, Switch, View } from "react-native";
import { ChatText as Text } from "./chat-text";
import {
  needUnitSchema,
  needMembershipSchema,
  productSubstitutionSchema,
  storeContextSettingsSchema,
  storeProductEventSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { CopilotStoreConflictController } from "./store-conflict-controller";
import { storeEventSummary } from "../needs/store-event-presentation";
import { storeContextSummary } from "../store/context-presentation";
import { colors } from "../design/tokens";
export function StoreConflictCard({
  message,
  controller,
}: {
  message: CopilotMessage;
  controller: CopilotStoreConflictController;
}) {
  const [state, setState] =
      useState<Awaited<ReturnType<CopilotStoreConflictController["open"]>>>(),
    [decision, setDecision] = useState<"KEEP_LOCAL" | "ADOPT_REMOTE" | null>(
      null,
    ),
    [reviewed, setReviewed] = useState(false),
    [reactivateRejected, setReactivateRejected] = useState(false),
    [localDeletionConfirmed, setLocalDeletionConfirmed] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string>();
  const revision = useRef(0),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      const v = ++revision.current;
      setState(undefined);
      setDecision(null);
      setReviewed(false);
      setReactivateRejected(false);
      setLocalDeletionConfirmed(false);
      setSaving(false);
      setError(undefined);
      void controller
        .open(message)
        .then((s) => {
          if (revision.current === v) setState(s);
        })
        .catch(() => {
          if (revision.current === v)
            setError(
              "La comparaison ne peut pas être préparée. Synchronisez puis demandez un nouvel aperçu ; les deux versions restent conservées.",
            );
        });
      return () => {
        revision.current++;
        abort.current?.abort();
      };
    }, [controller, message]),
  );
  const confirm = async () => {
    if (
      locked.current ||
      state?.status !== "READY" ||
      !decision ||
      !reviewed ||
      (reactivationRequired && !reactivateRejected) ||
      (localDeletionRequired && !localDeletionConfirmed)
    )
      return;
    const v = revision.current,
      cancel = new AbortController();
    locked.current = true;
    abort.current = cancel;
    setSaving(true);
    setError(undefined);
    try {
      const next = await controller.confirm(
        message,
        state.review!.basisHash,
        decision,
        true,
        cancel.signal,
        {
          reactivateRejected:
            !!reactivationRequired &&
            !retentionRequired &&
            !activationRequired &&
            !deletionRequired &&
            reactivateRejected,
          retainWithdrawn: !!retentionRequired && reactivateRejected,
          activateProduct: !!activationRequired && reactivateRejected,
          acceptRemoteDeletion: !!deletionRequired && reactivateRejected,
          confirmLocalDeletionChoice:
            !!localDeletionRequired && localDeletionConfirmed,
        },
      );
      if (revision.current === v) setState(next);
    } catch {
      if (revision.current === v) {
        setReviewed(false);
        setReactivateRejected(false);
        setLocalDeletionConfirmed(false);
        setDecision(null);
        setError(
          "L’état a changé ou la résolution n’a pas été enregistrée. Relisez la comparaison avant de confirmer.",
        );
        const next = await controller.open(message).catch(() => undefined);
        if (revision.current === v) setState(next);
      }
    } finally {
      locked.current = false;
      if (abort.current === cancel) abort.current = undefined;
      if (revision.current === v) setSaving(false);
    }
  };
  const review = state?.review;
  const localDeletionRequired =
    !!decision &&
    !!review?.cataloguePolicy?.localDeleted &&
    !review.cataloguePolicy.remoteDeleted;
  const localDeletionLabel =
    decision === "KEEP_LOCAL"
      ? "Je confirme le maintien de ma suppression malgré la modification synchronisée."
      : "Je confirme l’annulation de ma suppression et le rétablissement de la version synchronisée.";
  const retentionRequired =
    decision === "KEEP_LOCAL"
      ? review?.commercialPolicy?.retainLocal
      : decision === "ADOPT_REMOTE"
        ? review?.commercialPolicy?.retainRemote
        : false;
  const activationRequired =
    decision === "KEEP_LOCAL"
      ? review?.cataloguePolicy?.activateLocal
      : decision === "ADOPT_REMOTE"
        ? review?.cataloguePolicy?.activateRemote
        : false;
  const deletionRequired =
    decision === "ADOPT_REMOTE" && !!review?.cataloguePolicy?.remoteDeleted;
  const reactivationRequired =
    deletionRequired ||
    activationRequired ||
    retentionRequired ||
    (decision === "KEEP_LOCAL"
      ? review?.needPolicy?.reactivateLocal ||
        review?.cataloguePolicy?.reactivateLocal
      : decision === "ADOPT_REMOTE"
        ? review?.needPolicy?.reactivateRemote ||
          review?.cataloguePolicy?.reactivateRemote
        : false);
  const summary = (raw: unknown) => {
    if (state && isCatalogueConflictKind(state.content.input.kind))
      return catalogueConflictSummary(
        state.content.input.kind,
        raw,
        review?.cataloguePolicy?.products,
      );
    switch (state?.content.input.kind) {
      case "COMMERCIAL_REFERENCE": {
        const e = commercialVersionDecisionSchema.parse(raw),
          selected = e.preference === "KEEP_PREVIOUS" ? e.before : e.after;
        const name = (id: string) =>
          review?.commercialDecisionPolicy?.documents[id] ??
          `PDF ${id === e.before.documentId ? e.before.checksum.slice(-8) : e.after.checksum.slice(-8)}`;
        return `Référence choisie : ${name(selected.documentId)}\nDocuments comparés : ${name(e.before.documentId)} et ${name(e.after.documentId)}\nNote : ${e.note || "aucune"}`;
      }
      case "COMMERCIAL_EXECUTION":
        return commercialExecutionSummary(
          commercialExecutionTaskSchema.parse(raw),
        );
      case "COMMERCIAL_CHOICE": {
        const e = commercialOfferChoiceSchema.parse(raw);
        return `${commercialChoiceSummary(e)}\nProduit associé : ${review?.commercialPolicy?.products[e.productId] ?? "Fiche indisponible"}\nNote : ${e.note || "aucune"}\nApplicabilité et champs critiques confirmés dans cette version. Extrait PDF conservé.`;
      }
      case "COMMERCIAL_PREPARATION": {
        const e = commercialWeekPreparationSchema.parse(raw);
        return `${commercialPreparationSummary(e)}\nOffres : ${e.offerRefs.map((r) => `${review?.commercialPolicy?.choices[r.choiceId] ?? "Offre indisponible"} (v${r.choiceVersion})`).join(" · ") || "aucune"}\nAffectations : ${e.placements.map((p) => `${p.label} : ${p.offerIds.map((id) => review?.commercialPolicy?.choices[id] ?? "Offre indisponible").join(" · ") || "aucune offre"}`).join("\n")}\nNote : ${e.note || "aucune"}`;
      }
      case "COMMERCIAL_PLAN": {
        const e = commercialWeekPlanSchema.parse(raw);
        return `${commercialPlanSummary(e)}\nNote du brouillon : ${e.preparation.note || "aucune"}`;
      }
      case "FIELD_EVENT":
        return storeEventSummary(storeProductEventSchema.parse(raw));
      case "SETTINGS":
        return storeContextSummary(storeContextSettingsSchema.parse(raw));
      case "NEED":
        return needUnitSummary(needUnitSchema.parse(raw));
      case "MEMBERSHIP": {
        const e = needMembershipSchema.parse(raw),
          names = review?.needPolicy?.names;
        return `${names?.products[e.productId] ?? "Produit conservé"} → ${names?.needs[e.needUnitId] ?? "Besoin conservé"} · ${membershipSummary(e)}`;
      }
      case "SUBSTITUTION":
        return substitutionSummary(
          productSubstitutionSchema.parse(raw),
          review?.needPolicy?.names,
        );
      default:
        return "Version indisponible.";
    }
  };
  const choice = (
    value: "KEEP_LOCAL" | "ADOPT_REMOTE",
    label: string,
    enabled: boolean,
  ) => (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{
        checked: decision === value,
        disabled: saving || !enabled,
      }}
      disabled={saving || !enabled}
      onPress={() => {
        setDecision(value);
        setReviewed(false);
        setReactivateRejected(false);
        setLocalDeletionConfirmed(false);
      }}
      style={{
        minHeight: 44,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.forest,
        borderRadius: 12,
        opacity: enabled ? 1 : 0.45,
        backgroundColor:
          decision === value ? colors.positiveSoft : colors.surface,
      }}
    >
      <Text style={{ color: colors.forest, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderColor: colors.forest,
        borderRadius: 16,
      }}
    >
      <Text style={{ fontWeight: "700", color: colors.forest }}>
        {state
          ? {
              PRODUCT: "Comparer la fiche produit",
              IDENTIFIER: "Comparer le code produit",
              ALIAS: "Comparer le libellé associé",
              COMMERCIAL_REFERENCE: "Comparer la référence PDF",
              COMMERCIAL_EXECUTION: "Comparer la déclaration d’exécution",
              COMMERCIAL_CHOICE: "Comparer le choix d’offre",
              COMMERCIAL_PREPARATION: "Comparer le brouillon commercial",
              COMMERCIAL_PLAN: "Comparer le plan de semaine",
              FIELD_EVENT: "Comparer le signalement magasin",
              SETTINGS: "Comparer les réglages magasin",
              NEED: "Comparer le besoin client",
              MEMBERSHIP: "Comparer l’association au besoin",
              SUBSTITUTION: "Comparer la substitution",
            }[state.content.input.kind]
          : "Comparer les versions"}
      </Text>
      {!state && !error ? (
        <ActivityIndicator accessibilityLabel="Lecture des deux versions" />
      ) : null}
      {review ? (
        <>
          {(review.catalogueConflicts?.length ?? 0) > 1 ? (
            <Text style={{ color: colors.ink }}>
              {review.catalogueConflicts!.length} conflits concernent cette même
              fiche. Votre choix porte sur la version locale actuelle et la
              version synchronisée v{review.remote?.version}. Les versions
              précédentes restent conservées dans l’historique.
            </Text>
          ) : null}
          {(review.settingsReview?.group.conflicts.length ?? 0) > 1 ? (
            <Text style={{ color: colors.ink }}>
              {review.settingsReview!.group.conflicts.length} conflits
              concernent les mêmes réglages. Votre choix porte sur les réglages
              locaux actuels et la version synchronisée v
              {review.remote?.version}. Les versions précédentes restent
              conservées.
            </Text>
          ) : null}
          <Text style={{ fontWeight: "600" }}>Votre version actuelle</Text>
          <Text style={{ color: colors.ink }}>
            {summary(review.current.entity)}
          </Text>
          <Text style={{ fontWeight: "600" }}>Version synchronisée</Text>
          <Text style={{ color: colors.ink }}>
            {review.remote ? summary(review.remote) : "Version indisponible."}
          </Text>
        </>
      ) : null}
      {state?.content.basis.choice ? (
        <Pressable
          accessibilityRole="button"
          style={{ minHeight: 44, padding: 12 }}
          onPress={() =>
            router.push({
              pathname: "/commercial-offer/[id]",
              params: {
                id: state.content.basis.choice!.source.readingId,
                operationIndex:
                  state.content.basis.choice!.source.operationIndex,
                itemIndex: state.content.basis.choice!.source.itemIndex,
              },
            })
          }
        >
          <Text
            style={{ color: colors.forest, textDecorationLine: "underline" }}
          >
            Voir l’offre et sa source
          </Text>
        </Pressable>
      ) : null}
      {state?.content.basis.reference
        ? [
            state.content.basis.reference.before,
            state.content.basis.reference.after,
          ].map((source) => (
            <View key={source.documentId} style={{ gap: 6 }}>
              <Text style={{ color: colors.ink }}>
                {review?.commercialDecisionPolicy?.documents[
                  source.documentId
                ] ?? `PDF ${source.checksum.slice(-8)}`}
              </Text>
              <CommercialOriginalButton
                sourceDocumentId={source.documentId}
                label={`Consulter ${review?.commercialDecisionPolicy?.documents[source.documentId] ?? `PDF ${source.checksum.slice(-8)}`}`}
              />
            </View>
          ))
        : null}
      <Text accessibilityLiveRegion="polite">
        {state?.status === "COMPLETED"
          ? `Résolution enregistrée : ${state.result.decision === "KEEP_LOCAL" ? "votre version a été retenue" : "la version synchronisée a été adoptée"}. ${state.result.syncState === "PENDING" ? "L’envoi reste à synchroniser." : "Aucun nouvel envoi n’est nécessaire."}`
          : state?.status === "UNCHANGED"
            ? "Aucun conflit ouvert à résoudre sur cet appareil."
            : state?.status === "BLOCKED"
              ? review?.reason
              : "Comparez les deux versions avant de choisir. Aucune n’est retenue automatiquement ; l’historique est conservé."}
      </Text>
      {state?.status === "READY" && review ? (
        <>
          {state.content.input.kind === "FIELD_EVENT" ? (
            <Text style={{ color: colors.ink }}>
              La capture initiale reste immuable. Seule votre heure de fin peut
              être conservée si les captures correspondent.
            </Text>
          ) : state.content.input.kind === "SETTINGS" ? (
            <Text style={{ color: colors.ink }}>
              Ce choix retient un réglage déjà enregistré. Il ne demande pas de
              nouvelle position au téléphone.
            </Text>
          ) : review.cataloguePolicy ? (
            <Text style={{ color: colors.ink }}>
              {review.cataloguePolicy.remoteDeleted
                ? "La suppression concerne uniquement cette fiche ou identité. Les ventes, la casse et les sources restent inchangées."
                : "Seule la version choisie de cette fiche ou identité est retenue. Les autres codes et associations restent conservés. Pour un alias, la confiance synchronisée est préservée ; une réactivation exige une confirmation distincte."}
            </Text>
          ) : review.commercialDecisionPolicy ? (
            <Text style={{ color: colors.ink }}>
              {state.content.input.kind === "COMMERCIAL_REFERENCE"
                ? "Votre choix porte sur le fichier désigné, même si l’ordre des deux PDF diffère. Les originaux et les plans déjà enregistrés restent conservés."
                : "Vous retenez une déclaration déjà enregistrée, avec sa date d’origine. Elle reste liée à la version exacte du plan ; ce choix ne constate pas une nouvelle exécution en rayon."}
            </Text>
          ) : review.commercialPolicy ? (
            <Text style={{ color: colors.ink }}>
              Les sources restent conservées. Conserver un plan reconstruit ses
              offres et opérations après vérification ; aucune exécution en
              rayon n’est déclarée. Les validations antérieures peuvent
              nécessiter une nouvelle revue.
            </Text>
          ) : (
            <Text style={{ color: colors.ink }}>
              {state.content.input.kind === "SUBSTITUTION"
                ? "La relation garde son sens. Conserver votre version retient vos déclarations ; les scores appris synchronisés sont préservés."
                : "Les identités et l’historique restent conservés. Réactiver une association rejetée nécessite une confirmation distincte."}
            </Text>
          )}
          {choice(
            "KEEP_LOCAL",
            state.content.input.kind === "FIELD_EVENT"
              ? "Conserver mon heure de fin"
              : state.content.input.kind === "SETTINGS"
                ? "Conserver mes réglages locaux"
                : review.cataloguePolicy?.localDeleted &&
                    !review.cataloguePolicy.remoteDeleted
                  ? "Maintenir ma suppression locale"
                  : "Conserver ma version locale",
            review.canKeepLocal,
          )}
          {choice(
            "ADOPT_REMOTE",
            review.cataloguePolicy?.remoteDeleted
              ? "Accepter la suppression synchronisée"
              : review.cataloguePolicy?.localDeleted
                ? "Annuler ma suppression et rétablir la version synchronisée"
                : "Adopter la version synchronisée",
            review.canAdoptRemote,
          )}
          {review.cataloguePolicy && !review.canKeepLocal ? (
            <Text style={{ color: colors.ink }}>
              {review.cataloguePolicy.reason}
            </Text>
          ) : null}
          {review.commercialDecisionPolicy && !review.canKeepLocal ? (
            <Text style={{ color: colors.ink }}>
              {review.commercialDecisionPolicy.reason}
            </Text>
          ) : null}
          {review.commercialPolicy && !review.canKeepLocal ? (
            <Text style={{ color: colors.ink }}>
              {review.commercialPolicy.reason}
            </Text>
          ) : null}
          {review.needPolicy && !review.canKeepLocal ? (
            <Text style={{ color: colors.ink }}>
              La version locale ne peut pas être renvoyée : vérifiez les
              identités et l’état des produits ou du besoin.
            </Text>
          ) : null}
          {localDeletionRequired ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Switch
                accessibilityLabel={localDeletionLabel}
                disabled={saving}
                value={localDeletionConfirmed}
                onValueChange={setLocalDeletionConfirmed}
              />
              <Text style={{ color: colors.ink, flex: 1 }}>
                {localDeletionLabel}
              </Text>
            </View>
          ) : null}
          {reactivationRequired ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Switch
                accessibilityLabel={
                  deletionRequired
                    ? "Je confirme l’acceptation de la suppression synchronisée"
                    : activationRequired
                      ? "Je confirme explicitement la remise en activité du produit"
                      : retentionRequired
                        ? "Je confirme explicitement de retenir cette offre retirée"
                        : "Je confirme explicitement la réactivation de cette association rejetée"
                }
                disabled={saving}
                value={reactivateRejected}
                onValueChange={setReactivateRejected}
              />
              <Text style={{ color: colors.ink, flex: 1 }}>
                {deletionRequired
                  ? "Je confirme cette suppression. Ma saisie locale reste conservée sur cet appareil pour traçabilité."
                  : activationRequired
                    ? "Je confirme explicitement la remise en activité du produit."
                    : retentionRequired
                      ? "Cette offre a été retirée. Je confirme explicitement de la retenir à nouveau."
                      : "Cette association a été rejetée. Je confirme explicitement sa réactivation."}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Switch
              accessibilityLabel="J’ai comparé les deux versions et je confirme mon choix"
              value={reviewed}
              disabled={saving || !decision}
              onValueChange={setReviewed}
            />
            <Text style={{ color: colors.ink, flex: 1 }}>
              J’ai comparé les deux versions et je confirme mon choix.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled:
                saving ||
                !reviewed ||
                !decision ||
                (!!reactivationRequired && !reactivateRejected) ||
                (localDeletionRequired && !localDeletionConfirmed),
              busy: saving,
            }}
            disabled={
              saving ||
              !reviewed ||
              !decision ||
              (!!reactivationRequired && !reactivateRejected) ||
              (localDeletionRequired && !localDeletionConfirmed)
            }
            onPress={() => void confirm()}
            style={{
              minHeight: 44,
              padding: 14,
              borderRadius: 12,
              backgroundColor: colors.forest,
              opacity:
                saving ||
                !reviewed ||
                !decision ||
                (!!reactivationRequired && !reactivateRejected) ||
                (localDeletionRequired && !localDeletionConfirmed)
                  ? 0.45
                  : 1,
            }}
          >
            <Text
              style={{
                color: colors.onAccent,
                fontWeight: "600",
                textAlign: "center",
              }}
            >
              {saving ? "Enregistrement…" : "Confirmer cette résolution"}
            </Text>
          </Pressable>
        </>
      ) : null}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.critical }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
