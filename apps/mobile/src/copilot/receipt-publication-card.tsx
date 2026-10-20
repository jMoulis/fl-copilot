import { useCallback, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, Switch, View } from "react-native";
import { ChatText as Text } from "./chat-text";
import type { CopilotMessage } from "@fl-copilot/domain";
import type { CopilotReceiptPublicationController } from "./receipt-publication-controller";
import { colors } from "../design/tokens";
export function ReceiptPublicationCard({
  message,
  controller,
  canConfirm,
}: {
  message: CopilotMessage;
  controller: CopilotReceiptPublicationController;
  canConfirm: boolean;
}) {
  const [state, setState] =
      useState<
        Awaited<ReturnType<CopilotReceiptPublicationController["open"]>>
      >(),
    [reviewed, setReviewed] = useState(false),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState<string>(),
    [saving, setSaving] = useState(false);
  const router = useRouter(),
    revision = useRef(0),
    locked = useRef(false),
    cancellation = useRef<AbortController | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      const version = ++revision.current;
      setState(undefined);
      setReviewed(false);
      setExpanded(false);
      setError(undefined);
      setSaving(false);
      void controller
        .open(message)
        .then((s) => {
          if (revision.current === version) setState(s);
        })
        .catch(() => {
          if (revision.current === version)
            setError(
              "Le brouillon n’est pas disponible pour cette revue. Synchronisez le ticket ou ouvrez-le depuis Casse.",
            );
        });
      return () => {
        revision.current++;
        cancellation.current?.abort();
      };
    }, [controller, message]),
  );
  const confirm = async () => {
    if (locked.current || !canConfirm || !reviewed || state?.status !== "READY")
      return;
    const version = revision.current,
      abort = new AbortController();
    locked.current = true;
    cancellation.current = abort;
    setSaving(true);
    setError(undefined);
    try {
      const next = await controller.confirm(
        message,
        state.review.basisHash,
        reviewed,
        abort.signal,
      );
      if (revision.current === version) setState(next);
    } catch {
      if (revision.current === version) {
        setError(
          "La publication n’a pas été enregistrée. Relisez les contrôles actualisés et confirmez à nouveau si le ticket est prêt.",
        );
        setReviewed(false);
        const next = await controller.open(message).catch(() => undefined);
        if (revision.current === version) {
          setState(next);
          if (!next)
            setError(
              "Le ticket ou sa source a changé. Synchronisez puis demandez une nouvelle revue de publication.",
            );
        }
      }
    } finally {
      locked.current = false;
      if (cancellation.current === abort) cancellation.current = undefined;
      if (revision.current === version) setSaving(false);
    }
  };
  const review = state?.review,
    done =
      state?.status === "COMPLETED" || state?.status === "ALREADY_PUBLISHED";
  const unit = (value: string | null | undefined) =>
    ({
      KG: "kg",
      PIECE: "pièce",
      PACK: "unité conditionnée",
      UNKNOWN: "unité à préciser",
    })[value ?? "UNKNOWN"];
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
        Publier le ticket de casse
      </Text>
      <Text>{state?.content.source.filename ?? "Ticket de casse"}</Text>
      {done ? (
        <Text>
          {state.status === "COMPLETED"
            ? `${state.result.publishedCount} ligne(s) publiée(s) sur cet appareil. La synchronisation peut rester en attente.`
            : "Ce ticket est déjà publié sur cet appareil."}
        </Text>
      ) : review ? (
        <>
          <Text>
            Date de casse :{" "}
            {review.receipt.confirmedWasteDate
              ?.split("-")
              .reverse()
              .join("/") ?? "À confirmer"}
          </Text>
          <Text>
            Caissier :{" "}
            {review.receipt.cashierNumberConfirmedAt
              ? (review.receipt.confirmedCashierNumber ?? "Non renseigné")
              : "Non confirmé"}
          </Text>
          <Text>
            {
              review.lines.filter((l) => l.line.validationStatus !== "EXCLUDED")
                .length
            }{" "}
            ligne(s) incluse(s) ·{" "}
            {
              review.lines.filter((l) => l.line.validationStatus === "EXCLUDED")
                .length
            }{" "}
            exclue(s)
          </Text>
          {review.issues.map((issue, i) => (
            <Text key={i} style={{ color: colors.critical }}>
              {issue.lineIndex !== undefined
                ? `Ligne ${issue.lineIndex + 1}${issue.label ? ` · ${issue.label}` : ""} : `
                : ""}
              {issue.message}
            </Text>
          ))}
          {review.warnings.length ? (
            <Text>
              {review.warnings.length} avertissement(s) non bloquant(s) sur le
              référentiel ou les quantités.
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={{ minHeight: 44, padding: 10 }}
            onPress={() => setExpanded((v) => !v)}
          >
            <Text style={{ color: colors.forest }}>
              {expanded
                ? "Masquer les lignes et avertissements"
                : "Voir les lignes et avertissements"}
            </Text>
          </Pressable>
          {expanded ? (
            <View style={{ gap: 10 }}>
              {review.lines.map(({ line, productLabel }) => (
                <View key={line.id} style={{ gap: 3 }}>
                  <Text style={{ fontWeight: "600" }}>
                    {line.sourceLineIndex + 1}. {line.rawLabel}
                    {line.validationStatus === "EXCLUDED" ? " — Exclue" : ""}
                  </Text>
                  <Text>{productLabel}</Text>
                  <Text>
                    Poids : {line.weight ?? "Inconnu"} kg · Quantité :{" "}
                    {line.quantity ?? "Inconnue"} {unit(line.quantityUnit)} ·
                    Prix unitaire : {line.unitPrice ?? "Inconnu"} € · Montant :{" "}
                    {line.totalPrice ?? "Inconnu"} €
                  </Text>
                </View>
              ))}
              {review.warnings.map((w, i) => (
                <Text key={`warning-${i}`}>
                  {w.lineIndex !== undefined
                    ? `Ligne ${w.lineIndex + 1} : `
                    : ""}
                  {w.message}
                </Text>
              ))}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            style={{ minHeight: 44, padding: 10 }}
            onPress={() =>
              router.push({
                pathname: "/waste-receipt/[id]",
                params: { id: review.receipt.id },
              })
            }
          >
            <Text
              style={{ color: colors.forest, textDecorationLine: "underline" }}
            >
              Examiner la photo et corriger le ticket
            </Text>
          </Pressable>
          {state.status === "READY" && canConfirm ? (
            <>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <Switch
                  accessibilityLabel="J’ai vérifié les lignes, la date et les exclusions"
                  value={reviewed}
                  disabled={saving}
                  onValueChange={setReviewed}
                />
                <Text style={{ flex: 1 }}>
                  J’ai vérifié les lignes, la date et les exclusions.
                </Text>
              </View>
              <Text>
                Les montants sont valorisés au prix de vente. La publication
                conserve ces corrections et les exclusions. Elle ajoute la casse
                aux analyses sans modifier les ventes Mercalys.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: saving || !reviewed,
                  busy: saving,
                }}
                disabled={saving || !reviewed}
                style={{
                  minHeight: 44,
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: colors.forest,
                  opacity: saving || !reviewed ? 0.45 : 1,
                }}
                onPress={() => {
                  void confirm();
                }}
              >
                <Text
                  style={{
                    color: colors.onAccent,
                    textAlign: "center",
                    fontWeight: "600",
                  }}
                >
                  {saving ? "Publication…" : "Confirmer la publication"}
                </Text>
              </Pressable>
            </>
          ) : state.status === "BLOCKED" ? (
            <Text>
              Corrigez les champs signalés dans le ticket. Les contrôles seront
              actualisés à votre retour.
            </Text>
          ) : null}
        </>
      ) : !error ? (
        <ActivityIndicator accessibilityLabel="Vérification du brouillon local" />
      ) : null}
      {error && !state ? (
        <Pressable
          accessibilityRole="button"
          style={{ minHeight: 44, padding: 10 }}
          onPress={() => router.push("/(tabs)/waste")}
        >
          <Text style={{ color: colors.forest }}>
            Ouvrir les tickets de casse
          </Text>
        </Pressable>
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
