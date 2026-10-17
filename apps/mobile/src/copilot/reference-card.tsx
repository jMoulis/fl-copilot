import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { referenceDesiredValue } from "@fl-copilot/domain";
import { CommercialOriginalButton } from "../commercial/original-button";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotReferenceController } from "./reference-controller";
import { colors } from "../design/tokens";
export function ReferenceCard({
  message,
  controller,
  canConfirm,
  onSubmitted,
}: {
  message: CopilotMessage;
  controller: CopilotReferenceController;
  canConfirm: boolean;
  onSubmitted?: () => Promise<void>;
}) {
  const [state, setState] =
      useState<Awaited<ReturnType<CopilotReferenceController["open"]>>>(),
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
            "Le choix de référence ne peut pas être vérifié sur cet appareil. Synchronisez puis demandez un nouvel aperçu.",
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
          "Le choix de référence n’a pas pu être enregistré. La comparaison a peut-être changé : synchronisez puis demandez un nouvel aperçu.",
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
  const basis = state?.content.basis,
    desired = state
      ? referenceDesiredValue(state.content.input, state.content.basis)
      : null;
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
        Choisir le PDF de référence
      </Text>
      {basis && desired && state ? (
        <>
          <Text>Ancien PDF : {basis.beforeFilename}</Text>
          <CommercialOriginalButton
            sourceDocumentId={basis.sources.before.documentId}
          />
          <Text>PDF corrigé : {basis.afterFilename}</Text>
          <CommercialOriginalButton
            sourceDocumentId={basis.sources.after.documentId}
          />
          <Text style={{ fontWeight: "600" }}>
            Choix proposé :{" "}
            {desired.preference === "KEEP_PREVIOUS"
              ? "conserver l’ancien PDF"
              : "préférer le PDF corrigé"}
          </Text>
          {basis.previous ? (
            <Text>
              Choix actuel :{" "}
              {basis.previous.preference === "KEEP_PREVIOUS"
                ? "ancien PDF conservé"
                : "PDF corrigé préféré"}
            </Text>
          ) : (
            <Text>Aucun choix enregistré pour ces deux PDF.</Text>
          )}
          <Text>
            Les deux lectures sont complètes. {basis.counts.CHANGED} groupes
            d’offres modifiés · {basis.counts.AMBIGUOUS} ambigus ·{" "}
            {basis.warningCount} avertissements d’extraction.
          </Text>
          <Text>
            Ce choix conserve les offres retenues, les TG, les plans et les
            exécutions. Il ne valide aucune correspondance produit ; certaines
            références du brouillon pourront nécessiter une revue.
          </Text>
          {desired.note ? <Text>Note : {desired.note}</Text> : null}
          <Pressable
            accessibilityRole="button"
            style={{ minHeight: 44, padding: 12 }}
            onPress={() =>
              router.push({
                pathname: "/commercial-comparison",
                params: {
                  beforeId: basis.sources.before.documentId,
                  afterId: basis.sources.after.documentId,
                },
              })
            }
          >
            <Text
              style={{ color: colors.forest, textDecorationLine: "underline" }}
            >
              Examiner la comparaison complète
            </Text>
          </Pressable>
          {state.status === "READY" && canConfirm ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Switch
                accessibilityLabel="J’ai examiné la comparaison et les deux PDF originaux"
                value={reviewed}
                onValueChange={setReviewed}
                disabled={saving}
              />
              <Text style={{ flex: 1 }}>
                J’ai examiné la comparaison et les deux PDF originaux.
              </Text>
            </View>
          ) : null}
          <Text>
            {state.status === "COMPLETED"
              ? "Choix enregistré sur cet appareil. La synchronisation peut rester en attente."
              : state.status === "STALE"
                ? "Le choix ou ses lectures sources ont changé. Demandez un nouvel aperçu avant de confirmer."
                : "Vérifiez les originaux avant de confirmer ce choix de référence."}
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
                {saving
                  ? "Enregistrement…"
                  : desired.preference === "KEEP_PREVIOUS"
                    ? "Conserver l’ancien PDF"
                    : "Préférer le PDF corrigé"}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification du choix de référence" />
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
