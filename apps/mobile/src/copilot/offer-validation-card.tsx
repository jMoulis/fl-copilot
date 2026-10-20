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
import type { CopilotOfferValidationController } from "./offer-validation-controller";
import { colors } from "../design/tokens";
const terms = (m: CommercialMechanism) =>
  commercialMechanismDescription(m) +
  (m.type === "CARD_BENEFIT" ? ` · Portée : ${m.scope ?? "non précisée"}` : "");
export function OfferValidationCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotOfferValidationController;
  canConfirm: boolean;
}) {
  const [state, setState] =
    useState<Awaited<ReturnType<CopilotOfferValidationController["open"]>>>();
  const router = useRouter();
  const [showSource, setShowSource] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const locked = useRef(false),
    alive = useRef(true),
    abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    let active = true;
    setState(undefined);
    setShowSource(false);
    setReviewed(false);
    setError(undefined);
    void controller
      .open(message)
      .then((s) => {
        if (active && alive.current) setState(s);
      })
      .catch(() => {
        if (active && alive.current)
          setError("La validation ne peut pas être vérifiée sur cet appareil.");
      });
    return () => {
      active = false;
      alive.current = false;
      abort.current?.abort();
    };
  }, [controller, message]);
  const confirm = async () => {
    if (locked.current || !canConfirm || !reviewed) return;
    locked.current = true;
    setSaving(true);
    setError(undefined);
    const cancellation = new AbortController();
    abort.current = cancellation;
    try {
      const value = await controller.confirm(
        message,
        reviewed,
        cancellation.signal,
      );
      if (alive.current) setState(value);
    } catch {
      if (alive.current) {
        setError(
          "La validation n’a pas pu être enregistrée. Vérifiez la synchronisation et demandez un nouvel aperçu.",
        );
        const s = await controller.open(message).catch(() => undefined);
        if (alive.current && s) setState(s);
      }
    } finally {
      locked.current = false;
      if (abort.current === cancellation) abort.current = undefined;
      if (alive.current) setSaving(false);
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
        Valider les offres retenues
      </Text>
      {state ? (
        <>
          <Text>
            {state.content.basis.entries.length} offre(s) retenue(s), dans les
            versions affichées.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showSource }}
            style={{ minHeight: 44, padding: 12 }}
            onPress={() => setShowSource((v) => !v)}
          >
            <Text style={{ color: colors.forest }}>
              {showSource
                ? "Masquer les informations extraites"
                : "Comparer avec les informations extraites"}
            </Text>
          </Pressable>
          {state.content.basis.entries.map((e) => (
            <View
              key={e.choice.id}
              style={{
                gap: 8,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.forest,
              }}
            >
              <Text style={{ fontWeight: "600" }}>
                {e.choice.rawProductLabel}
              </Text>
              <Text>Produit : {e.product.label}</Text>
              <Text>
                {formatFrenchCalendarDate(e.choice.saleStart)} –{" "}
                {formatFrenchCalendarDate(e.choice.saleEnd)}
              </Text>
              <Text>{terms(e.choice.mechanism)}</Text>
              {e.choice.note ? <Text>Note : {e.choice.note}</Text> : null}
              <Text>
                {e.validation
                  ? "Déjà validée — validation conservée"
                  : "À valider après revue de la source"}
              </Text>
              {showSource
                ? [...e.offer.operationFields, ...e.offer.itemFields].map(
                    (f, i) => (
                      <Text key={i}>
                        {commercialFieldLabels[f.name] ??
                          commercialExtraFieldLabels[f.name] ??
                          "Information source"}{" "}
                        : {f.rawValue ?? "Non détecté"}
                        {f.evidence.some(
                          (ref) => ref.verification === "VISUAL_TO_VERIFY",
                        )
                          ? " · À vérifier visuellement"
                          : ""}
                      </Text>
                    ),
                  )
                : null}
              <Pressable
                accessibilityRole="button"
                style={{ minHeight: 44, padding: 12 }}
                onPress={() =>
                  router.push({
                    pathname: "/commercial-offer/[id]",
                    params: {
                      id: e.offer.source.readingId,
                      operationIndex: e.offer.source.operationIndex,
                      itemIndex: e.offer.source.itemIndex,
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
                  Voir l’offre et sa source · page {e.offer.pageNumber}
                </Text>
              </Pressable>
            </View>
          ))}
          <Text>
            Cette validation conserve une version des offres. Elle ne valide pas
            le plan hebdomadaire et ne déclare aucune installation ou exécution.
          </Text>
          {state.status === "READY" && canConfirm ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Switch
                accessibilityLabel="J’ai revu les sources et les conditions de toutes les offres affichées"
                value={reviewed}
                onValueChange={setReviewed}
                disabled={saving}
              />
              <Text style={{ flex: 1 }}>
                J’ai revu les sources et les conditions de toutes les offres
                affichées.
              </Text>
            </View>
          ) : null}
          <Text>
            {state.status === "COMPLETED"
              ? "Offres validées sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "Une offre, son produit, sa source ou sa validation a changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vérifiez les sources avant de confirmer la validation de ces versions d’offres."}
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
                  color: colors.onAccent,
                  textAlign: "center",
                  fontWeight: "600",
                }}
              >
                {saving
                  ? "Enregistrement…"
                  : "Confirmer la validation des offres"}
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
