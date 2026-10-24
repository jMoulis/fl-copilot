import { isCommercialOriginalSource } from "@fl-copilot/domain";
import { CommercialOriginalButton } from "../commercial/original-button";
import { commercialOfferHref } from "../commercial/offer-navigation";
import {
  commercialFieldLabels,
  commercialExtraFieldLabels,
} from "../commercial/review-presentation";
import { useRouter } from "expo-router";
import { commercialMechanismDescription } from "@fl-copilot/commercial-core";
import { formatFrenchCalendarDate } from "../dates/calendar";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Switch, View } from "react-native";
import { ChatText as Text } from "./chat-text";
import type { CopilotMessage, CommercialMechanism } from "@fl-copilot/domain";
import type { CopilotChoiceCreateController } from "./choice-create-controller";
import { colors } from "../design/tokens";
const terms = (m: CommercialMechanism) =>
  commercialMechanismDescription(m) +
  (m.type === "CARD_BENEFIT" ? ` · Portée : ${m.scope ?? "non précisée"}` : "");
export function ChoiceCreateCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotChoiceCreateController;
  canConfirm: boolean;
}) {
  const [state, setState] =
    useState<Awaited<ReturnType<CopilotChoiceCreateController["open"]>>>();
  const router = useRouter();
  const [showSource, setShowSource] = useState(false);
  const [critical, setCritical] = useState(false),
    [applicable, setApplicable] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const locked = useRef(false),
    generation = useRef(0),
    alive = useRef(true),
    abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    generation.current += 1;
    locked.current = false;
    setSaving(false);
    let active = true;
    setState(undefined);
    setShowSource(false);
    setCritical(false);
    setApplicable(false);
    setError(undefined);
    void controller
      .open(message)
      .then((s) => {
        if (active && alive.current) setState(s);
      })
      .catch(() => {
        if (active && alive.current)
          setError("La sélection ne peut pas être vérifiée sur cet appareil.");
      });
    return () => {
      active = false;
      alive.current = false;
      abort.current?.abort();
    };
  }, [controller, message]);
  const confirm = async () => {
    if (locked.current || !canConfirm || !critical || !applicable) return;
    const epoch = generation.current;
    const isCurrent = () => alive.current && generation.current === epoch;
    locked.current = true;
    setSaving(true);
    setError(undefined);
    const cancellation = new AbortController();
    abort.current = cancellation;
    try {
      const value = await controller.confirm(
        message,
        {
          criticalFieldsConfirmed: critical,
          applicabilityConfirmed: applicable,
        },
        cancellation.signal,
      );
      if (isCurrent()) setState(value);
    } catch {
      if (isCurrent()) {
        setError(
          "La sélection n’a pas pu être enregistrée. Vérifiez la synchronisation et demandez un nouvel aperçu.",
        );
        const s = await controller.open(message).catch(() => undefined);
        if (isCurrent() && s) setState(s);
      }
    } finally {
      if (isCurrent()) {
        locked.current = false;
        setSaving(false);
      }
      if (abort.current === cancellation) abort.current = undefined;
    }
  };
  return (
    <View
      style={{
        padding: 16,
        borderWidth: 1,
        borderColor: colors.forest,
        borderRadius: 16,
        gap: 10,
      }}
    >
      <Text style={{ color: colors.forest, fontWeight: "700" }}>
        Retenir une offre du document
      </Text>
      {state ? (
        <>
          <Text style={{ fontWeight: "600" }}>
            {state.content.basis.offer.operationLabel} ·{" "}
            {state.content.basis.offer.rawProductLabel}
          </Text>
          <Text>Produit retenu : {state.content.basis.product.label}</Text>
          <Text>
            Dates proposées :{" "}
            {formatFrenchCalendarDate(state.content.input.saleStart)} –{" "}
            {formatFrenchCalendarDate(state.content.input.saleEnd)}
          </Text>
          <Text>
            Conditions proposées : {terms(state.content.input.mechanism)}
          </Text>
          <Text>Note : {state.content.input.note || "Sans note"}</Text>
          <Text>
            {isCommercialOriginalSource(state.content.input.source)
              ? "Extrait du PDF original à vérifier"
              : "Source extraite à confirmer"}{" "}
            · page {state.content.basis.offer.pageNumber}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showSource }}
            style={{ minHeight: 44, padding: 12 }}
            onPress={() => setShowSource((v) => !v)}
          >
            <Text style={{ color: colors.forest }}>
              {isCommercialOriginalSource(state.content.input.source)
                ? showSource
                  ? "Masquer l’extrait du PDF"
                  : "Voir l’extrait du PDF"
                : showSource
                  ? "Masquer les informations extraites"
                  : "Comparer avec les informations extraites"}
            </Text>
          </Pressable>
          {showSource &&
          isCommercialOriginalSource(state.content.basis.offer.source) ? (
            <Text selectable>{state.content.basis.offer.source.excerpt}</Text>
          ) : null}
          {showSource
            ? [
                ...state.content.basis.offer.operationFields,
                ...state.content.basis.offer.itemFields,
              ].map((f, i) => (
                <Text key={i}>
                  {commercialFieldLabels[f.name] ??
                    commercialExtraFieldLabels[f.name] ??
                    "Information source"}{" "}
                  : {f.rawValue ?? "Non détecté"}
                  {f.evidence.some((e) => e.verification === "VISUAL_TO_VERIFY")
                    ? " · À vérifier visuellement"
                    : ""}
                </Text>
              ))
            : null}
          {isCommercialOriginalSource(state.content.basis.offer.source) ? (
            <CommercialOriginalButton
              sourceDocumentId={
                state.content.basis.offer.source.sourceDocumentId
              }
              label={`PDF original · page ${state.content.basis.offer.pageNumber}`}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              style={{ minHeight: 44, padding: 12 }}
              onPress={() =>
                router.push(
                  commercialOfferHref(state.content.basis.offer.source),
                )
              }
            >
              <Text
                style={{
                  color: colors.forest,
                  textDecorationLine: "underline",
                }}
              >
                Voir l’offre et sa source
              </Text>
            </Pressable>
          )}
          <Text>
            Retenir cette offre ne valide pas un plan, ne crée pas de TG et ne
            déclare pas une mise en rayon.
          </Text>
          {state.status === "READY" && canConfirm ? (
            <>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <Switch
                  accessibilityLabel="J’ai vérifié le produit, les dates et toutes les conditions avec la source"
                  value={critical}
                  onValueChange={setCritical}
                  disabled={saving}
                />
                <Text style={{ flex: 1 }}>
                  J’ai vérifié le produit, les dates et toutes les conditions
                  avec la source.
                </Text>
              </View>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <Switch
                  accessibilityLabel="Cette offre s’applique à mon magasin"
                  value={applicable}
                  onValueChange={setApplicable}
                  disabled={saving}
                />
                <Text style={{ flex: 1 }}>
                  Cette offre s’applique à mon magasin.
                </Text>
              </View>
            </>
          ) : null}
          <Text>
            {state.status === "COMPLETED"
              ? "Offre retenue sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "La source, le produit ou la sélection a changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vérifiez les informations proposées et confirmez l’applicabilité avant de retenir cette offre."}
          </Text>
          {state.status === "READY" && canConfirm ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: saving || !critical || !applicable,
                busy: saving,
              }}
              disabled={saving || !critical || !applicable}
              onPress={() => {
                void confirm();
              }}
              style={{
                minHeight: 44,
                padding: 14,
                borderRadius: 12,
                backgroundColor: colors.forest,
                opacity: saving || !critical || !applicable ? 0.45 : 1,
              }}
            >
              <Text
                style={{
                  color: colors.onAccent,
                  textAlign: "center",
                  fontWeight: "600",
                }}
              >
                {saving
                  ? "Enregistrement…"
                  : "Confirmer et retenir cette offre"}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification de la modification" />
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
