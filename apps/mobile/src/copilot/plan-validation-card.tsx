import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { commercialMechanismDescription } from "@fl-copilot/commercial-core";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotPlanValidationController } from "./plan-validation-controller";
import { formatFrenchCalendarDate } from "../dates/calendar";
import { colors } from "../design/tokens";
export function PlanValidationCard({
  message,
  controller,
  canConfirm,
  onSubmitted,
}: {
  message: CopilotMessage;
  controller: CopilotPlanValidationController;
  canConfirm: boolean;
  onSubmitted?: () => Promise<void>;
}) {
  const [state, setState] =
      useState<Awaited<ReturnType<CopilotPlanValidationController["open"]>>>(),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState<string>(),
    [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const alive = useRef(true),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined),
    router = useRouter();
  useEffect(() => {
    const version = ++revision.current;
    alive.current = true;
    setSaving(false);
    let active = true;
    setState(undefined);
    setReviewed(false);
    setError(undefined);
    void controller
      .open(message)
      .then((s) => {
        if (active && alive.current) setState(s);
      })
      .catch(() => {
        if (active && alive.current)
          setError(
            "Le plan ne peut pas être vérifié sur cet appareil. Synchronisez puis demandez un nouvel aperçu.",
          );
      });
    return () => {
      revision.current = version + 1;
      active = false;
      alive.current = false;
      abort.current?.abort();
    };
  }, [controller, message]);
  const confirm = async () => {
    if (locked.current || !canConfirm || !reviewed) return;
    const version = revision.current;
    const isCurrent = () => alive.current && revision.current === version;
    locked.current = true;
    setSaving(true);
    setError(undefined);
    const cancellation = new AbortController();
    abort.current = cancellation;
    try {
      const s = await controller.confirm(
        message,
        reviewed,
        cancellation.signal,
      );
      if (isCurrent()) setState(s);
      if (isCurrent()) await onSubmitted?.().catch(() => undefined);
    } catch {
      if (isCurrent()) {
        setError(
          "Le plan n’a pas pu être enregistré. Une donnée a peut-être changé : synchronisez puis demandez un nouvel aperçu.",
        );
        const s = await controller.open(message).catch(() => undefined);
        if (isCurrent() && s) setState(s);
      }
    } finally {
      locked.current = false;
      if (abort.current === cancellation) abort.current = undefined;
      if (isCurrent()) setSaving(false);
    }
  };
  const plan = state?.content.preview.candidate;
  return (
    <View
      style={{
        padding: 16,
        borderWidth: 1,
        borderColor: colors.forest,
        borderRadius: 16,
        gap: 12,
      }}
    >
      <Text style={{ color: colors.forest, fontWeight: "700" }}>
        Valider le plan de la semaine
      </Text>
      {plan && state ? (
        <>
          <Text>
            {formatFrenchCalendarDate(plan.weekStart)} –{" "}
            {formatFrenchCalendarDate(plan.weekEnd)} · Révision {plan.version}
          </Text>
          <Text>
            {plan.offers.length} offre(s) · {plan.preparation.placements.length}{" "}
            TG · Capacité déclarée :{" "}
            {plan.preparation.tgCapacity ?? "non précisée"}
          </Text>
          {plan.preparation.note ? (
            <Text>Note : {plan.preparation.note}</Text>
          ) : null}
          {plan.offers.map((o) => (
            <View key={o.id} style={{ gap: 4, paddingVertical: 8 }}>
              <Text style={{ fontWeight: "600" }}>{o.rawProductLabel}</Text>
              <Text>
                Produit :{" "}
                {plan.productRefs.find((p) => p.id === o.productId)?.label ??
                  "Indisponible"}
              </Text>
              <Text>
                {plan.operations.find((op) => op.id === o.operationId)?.name ??
                  "Opération"}
              </Text>
              <Text>
                {commercialMechanismDescription(o.customerMechanism)}
                {o.customerMechanism.type === "CARD_BENEFIT"
                  ? ` · Portée : ${o.customerMechanism.scope ?? "non précisée"}`
                  : ""}
              </Text>
              <Text>
                {formatFrenchCalendarDate(o.saleStart)} –{" "}
                {formatFrenchCalendarDate(o.saleEnd)}
              </Text>
              {o.note ? <Text>{o.note}</Text> : null}
              <Pressable
                accessibilityRole="button"
                style={{ minHeight: 44, padding: 12 }}
                onPress={() =>
                  router.push({
                    pathname: "/commercial-offer/[id]",
                    params: {
                      id: o.sourceReference.readingId,
                      operationIndex: o.sourceReference.operationIndex,
                      itemIndex: o.sourceReference.itemIndex,
                    },
                  })
                }
              >
                <Text
                  style={{
                    color: colors.forest,
                    textDecorationLine: "underline",
                  }}
                >
                  Voir l’offre et sa source · page{" "}
                  {o.sourceReference.pageNumber}
                </Text>
              </Pressable>
            </View>
          ))}
          {plan.preparation.placements.map((p) => (
            <View key={p.id} style={{ gap: 4 }}>
              <Text style={{ fontWeight: "600" }}>
                {p.label}
                {p.theme ? ` · ${p.theme}` : ""}
              </Text>
              <Text>
                {p.offerIds
                  .map(
                    (id) =>
                      plan.offers.find((o) => o.choiceId === id)
                        ?.rawProductLabel ?? "Offre indisponible",
                  )
                  .join(" · ")}
              </Text>
            </View>
          ))}
          <Text>
            Cette confirmation enregistre une révision du plan. Elle ne déclare
            aucune impression d’affiche ni installation en rayon.
          </Text>
          {state.status === "READY" && canConfirm ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Switch
                accessibilityLabel="J’ai revu les offres, leurs conditions et les affectations TG"
                value={reviewed}
                onValueChange={setReviewed}
                disabled={saving}
              />
              <Text style={{ flex: 1 }}>
                J’ai revu les offres, leurs conditions et les affectations TG.
              </Text>
            </View>
          ) : null}
          <Text>
            {state.status === "COMPLETED"
              ? "Plan enregistré sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "La préparation ou une référence a changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vérifiez le plan avant de confirmer."}
          </Text>
          {state.status === "READY" && canConfirm ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: saving || !reviewed,
                busy: saving,
              }}
              disabled={saving || !reviewed}
              onPress={() => {
                void confirm();
              }}
              style={{
                minHeight: 44,
                padding: 14,
                borderRadius: 12,
                backgroundColor: colors.forest,
                opacity: saving || !reviewed ? 0.45 : 1,
              }}
            >
              <Text
                style={{
                  color: "white",
                  textAlign: "center",
                  fontWeight: "600",
                }}
              >
                {saving ? "Enregistrement…" : "Confirmer le plan"}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            style={{ minHeight: 44, padding: 12 }}
            onPress={() =>
              router.push({
                pathname: "/commercial-plan",
                params: { weekStart: plan.weekStart },
              })
            }
          >
            <Text
              style={{ color: colors.forest, textDecorationLine: "underline" }}
            >
              Ouvrir le plan de la semaine
            </Text>
          </Pressable>
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification du plan" />
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
