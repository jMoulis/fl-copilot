import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import {
  identityReviewDesiredStatus,
  ProductClassificationError,
} from "@fl-copilot/domain";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotIdentityReviewController } from "./identity-review-controller";
import { colors } from "../design/tokens";
export function IdentityReviewCard({
  message,
  controller,
  canConfirm,
  onSubmitted,
}: {
  message: CopilotMessage;
  controller: CopilotIdentityReviewController;
  canConfirm: boolean;
  onSubmitted?: () => Promise<void>;
}) {
  const [state, setState] =
      useState<Awaited<ReturnType<CopilotIdentityReviewController["open"]>>>(),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState<string>(),
    [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const alive = useRef(true),
    locked = useRef(false),
    abort = useRef<AbortController | undefined>(undefined);
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
            "La correspondance a changé ou ne peut pas être vérifiée. Synchronisez puis demandez un nouvel aperçu.",
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
    if (locked.current || !canConfirm || (reactivation && !reviewed)) return;
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
    } catch (cause) {
      if (isCurrent()) {
        setError(
          cause instanceof ProductClassificationError
            ? cause.message
            : "La correspondance ne peut pas être enregistrée. Synchronisez puis demandez un nouvel aperçu.",
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
  const basis = state?.content.before,
    reactivation =
      state?.content.input.decision === "VALIDATE" &&
      basis?.entry.status === "REJECTED";
  const statusLabel = (value: string) =>
    ({ VALIDATED: "Validé", TO_REVIEW: "À confirmer", REJECTED: "Refusé" })[
      value
    ] ?? value;
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
        Correspondance produit
      </Text>
      {basis && state ? (
        <>
          <Text style={{ fontWeight: "600" }}>{basis.product.label}</Text>
          <Text>
            {"alias" in basis.entry
              ? `Alias : ${basis.entry.alias}`
              : `${basis.entry.type} : ${basis.entry.value}`}
          </Text>
          <Text>Avant : {statusLabel(basis.entry.status)}</Text>
          <Text>
            Après :{" "}
            {statusLabel(identityReviewDesiredStatus(state.content.input))}
          </Text>
          <Text>
            Cette décision porte uniquement sur cette correspondance. Elle
            conserve les chiffres déjà publiés et l’origine de la donnée.
          </Text>
          {state.status === "READY" && canConfirm && reactivation ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Switch
                accessibilityLabel="Je réactive explicitement cet alias précédemment refusé"
                value={reviewed}
                onValueChange={setReviewed}
                disabled={saving}
              />
              <Text style={{ flex: 1 }}>
                Je réactive explicitement cet alias précédemment refusé.
              </Text>
            </View>
          ) : null}
          <Text>
            {state.status === "COMPLETED"
              ? "Décision enregistrée sur cet appareil. La synchronisation peut rester en attente."
              : "Vérifiez le produit et la correspondance avant de confirmer."}
          </Text>
          {state.status === "READY" && canConfirm ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: saving || (reactivation && !reviewed),
                busy: saving,
              }}
              disabled={saving || (reactivation && !reviewed)}
              onPress={() => {
                void confirm();
              }}
              style={{
                minHeight: 44,
                padding: 14,
                borderRadius: 12,
                backgroundColor: colors.forest,
                opacity: saving || (reactivation && !reviewed) ? 0.45 : 1,
              }}
            >
              <Text
                style={{
                  color: "white",
                  textAlign: "center",
                  fontWeight: "600",
                }}
              >
                {saving ? "Enregistrement…" : "Confirmer cette décision"}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification de la correspondance" />
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
