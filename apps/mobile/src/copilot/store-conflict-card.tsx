import { needUnitSummary } from "../needs/presentation";
import { membershipSummary } from "../needs/membership-presentation";
import { substitutionSummary } from "../needs/substitution-presentation";
import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
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
      (reactivationRequired && !reactivateRejected)
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
        reactivateRejected,
      );
      if (revision.current === v) setState(next);
    } catch {
      if (revision.current === v) {
        setReviewed(false);
        setReactivateRejected(false);
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
  const reactivationRequired =
    decision === "KEEP_LOCAL"
      ? review?.needPolicy?.reactivateLocal
      : decision === "ADOPT_REMOTE"
        ? review?.needPolicy?.reactivateRemote
        : false;
  const summary = (raw: unknown) => {
    switch (state?.content.input.kind) {
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
      }}
      style={{
        minHeight: 44,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.forest,
        borderRadius: 12,
        opacity: enabled ? 1 : 0.45,
        backgroundColor: decision === value ? colors.positiveSoft : "white",
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
          <Text style={{ fontWeight: "600" }}>Votre version actuelle</Text>
          <Text>{summary(review.current.entity)}</Text>
          <Text style={{ fontWeight: "600" }}>Version synchronisée</Text>
          <Text>
            {review.remote ? summary(review.remote) : "Version indisponible."}
          </Text>
        </>
      ) : null}
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
            <Text>
              La capture initiale reste immuable. Seule votre heure de fin peut
              être conservée si les captures correspondent.
            </Text>
          ) : state.content.input.kind === "SETTINGS" ? (
            <Text>
              Ce choix retient un réglage déjà enregistré. Il ne demande pas de
              nouvelle position au téléphone.
            </Text>
          ) : (
            <Text>
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
                : "Conserver ma version locale",
            review.canKeepLocal,
          )}
          {choice(
            "ADOPT_REMOTE",
            "Adopter la version synchronisée",
            review.canAdoptRemote,
          )}
          {review.needPolicy && !review.canKeepLocal ? (
            <Text>
              La version locale ne peut pas être renvoyée : vérifiez les
              identités et l’état des produits ou du besoin.
            </Text>
          ) : null}
          {reactivationRequired ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Switch
                accessibilityLabel="Je confirme explicitement la réactivation de cette association rejetée"
                disabled={saving}
                value={reactivateRejected}
                onValueChange={setReactivateRejected}
              />
              <Text style={{ flex: 1 }}>
                Cette association a été rejetée. Je confirme explicitement sa
                réactivation.
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
            <Text style={{ flex: 1 }}>
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
                (!!reactivationRequired && !reactivateRejected),
              busy: saving,
            }}
            disabled={
              saving ||
              !reviewed ||
              !decision ||
              (!!reactivationRequired && !reactivateRejected)
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
                (!!reactivationRequired && !reactivateRejected)
                  ? 0.45
                  : 1,
            }}
          >
            <Text
              style={{ color: "white", fontWeight: "600", textAlign: "center" }}
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
