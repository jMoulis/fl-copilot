import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  type LayoutChangeEvent,
  Text,
  View,
} from "react-native";
import { SectionCard, SecondaryButton } from "../components/ui";
import type { WastePublicationIssue } from "./waste-publication-validation";
export function ReceiptIssueSummary({
  issues,
  onLocate,
  published = false,
  disabled = false,
}: {
  published?: boolean;
  disabled?: boolean;
  issues: readonly WastePublicationIssue[];
  onLocate(issue: WastePublicationIssue): void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? issues : issues.slice(0, 5);
  return (
    <SectionCard
      title="Champs à corriger"
      description={
        published
          ? "Le ticket est publié ; ces saisies non enregistrées ne le modifient pas."
          : "Appuyez sur une correction pour rejoindre la section concernée. Aucune ligne n’a été publiée."
      }
    >
      <Text accessibilityLiveRegion="polite" className="text-sm text-muted">
        {issues.length} correction{issues.length > 1 ? "s" : ""} à examiner
      </Text>
      {visible.map((issue, index) => (
        <Pressable
          key={`${issue.lineId ?? issue.field}:${index}`}
          accessibilityRole="button"
          disabled={disabled}
          accessibilityState={{ disabled }}
          accessibilityLabel={`${issue.lineIndex !== undefined ? `Ligne ${issue.lineIndex + 1}. ` : ""}${issue.message} Voir le champ à corriger`}
          onPress={() => onLocate(issue)}
          className="min-h-12 justify-center rounded-xl border border-critical bg-critical-soft p-3"
        >
          <Text className="text-sm leading-5 text-critical">
            {issue.lineIndex !== undefined
              ? `Ligne ${issue.lineIndex + 1}${issue.label ? ` · ${issue.label}` : ""} : `
              : ""}
            {issue.message}
          </Text>
          <Text className="mt-1 text-sm font-semibold text-ink">
            Voir la correction
          </Text>
        </Pressable>
      ))}
      {issues.length > 5 ? (
        <SecondaryButton
          label={
            showAll
              ? "Réduire la liste des corrections"
              : `Afficher les ${issues.length - 5} autres corrections`
          }
          expanded={showAll}
          disabled={disabled}
          onPress={() => setShowAll((v) => !v)}
        />
      ) : null}
    </SectionCard>
  );
}

/** Native content coordinates, updated by layout; no timers or business mutations. */
export function useReceiptIssueNavigation() {
  const scrollRef = useRef<ScrollView>(null),
    sectionTop = useRef<Record<string, number>>({}),
    groupTop = useRef<Record<string, number>>({}),
    linesTop = useRef<number | undefined>(undefined);
  const pendingIssue = useRef<WastePublicationIssue | undefined>(undefined),
    frame = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );
  function scrollPending() {
    if (!pendingIssue.current || frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const issue = pendingIssue.current;
      if (!issue) return;
      const y = issue.lineId
        ? linesTop.current !== undefined &&
          groupTop.current[issue.lineId] !== undefined
          ? linesTop.current + groupTop.current[issue.lineId]!
          : undefined
        : issue.field === "lines"
          ? linesTop.current
          : (sectionTop.current[
              ["date", "cashierNumber", "duplicate"].includes(issue.field)
                ? issue.field
                : "processing"
            ] ?? sectionTop.current.processing);
      if (y === undefined) return;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
      pendingIssue.current = undefined;
    });
  }
  return {
    scrollRef,
    anchor: (key: string) => (e: LayoutChangeEvent) => {
      sectionTop.current[key] = e.nativeEvent.layout.y;
      scrollPending();
    },
    linesAnchor: (e: LayoutChangeEvent) => {
      linesTop.current = e.nativeEvent.layout.y;
      scrollPending();
    },
    groupAnchor: (ids: readonly string[]) => (e: LayoutChangeEvent) => {
      for (const id of ids) groupTop.current[id] = e.nativeEvent.layout.y;
      scrollPending();
    },
    locate: (
      issue: WastePublicationIssue,
      options?: { waitForGroupLayout?: boolean },
    ) => {
      // Opening another editor changes the preceding card heights. Do not scroll
      // using the former collapsed/expanded coordinates; the next layout resumes it.
      if (issue.lineId && options?.waitForGroupLayout)
        delete groupTop.current[issue.lineId];
      pendingIssue.current = issue;
      scrollPending();
    },
  };
}

/** Source measurements stay separate: no sum of kg/pieces and no missing value turned into zero. */
export function ReceiptLinePreview({
  draft,
  compact = false,
}: {
  draft: import("./waste-receipt-repository").LocalWasteLineDraft;
  compact?: boolean;
}) {
  const l = draft.line,
    decimal = (s: string) => s.replace(".", ",");
  const quantity =
    l.quantity != null
      ? `Quantité : ${decimal(l.quantity)} (${l.quantityUnit === "PIECE" ? "pièces" : l.quantityUnit === "PACK" ? "unités conditionnées" : l.quantityUnit === "KG" ? "kg" : "unité à préciser"})`
      : null;
  return (
    <View className="gap-1 rounded-xl border border-line bg-canvas p-3">
      <Text className="font-semibold text-ink">
        {compact ? `Ligne ${l.sourceLineIndex + 1} · ` : ""}
        {draft.matchedProductLabel ?? "Produit à associer"}
      </Text>
      <Text className="text-sm text-muted">
        {l.productNature === "BULK"
          ? "Vrac"
          : l.productNature === "PACKAGED"
            ? "Conditionné"
            : "Nature non précisée"}
        {l.validationStatus === "EXCLUDED" ? " · Ligne exclue" : ""}
      </Text>
      <Text className="text-sm text-muted">
        {compact ? (
          [
            l.weight != null ? `Poids : ${decimal(l.weight)} kg` : null,
            quantity,
          ]
            .filter(Boolean)
            .join(" · ") || "Quantité non renseignée"
        ) : (
          <>
            {l.weight != null
              ? `Poids : ${decimal(l.weight)} kg`
              : "Poids non renseigné"}
            {quantity ? ` · ${quantity}` : ""}
          </>
        )}
      </Text>
      {!compact ? (
        <Text className="text-sm text-ink">
          {l.unitPrice != null
            ? `Prix unitaire : ${decimal(l.unitPrice)} €`
            : "Prix unitaire non renseigné"}
        </Text>
      ) : null}
      <Text className="font-semibold text-ink">
        {l.totalPrice != null
          ? `Montant : ${decimal(l.totalPrice)} €`
          : "Montant non renseigné"}
      </Text>
      {draft.arithmeticStatus === "MISMATCH" ? (
        <Text className="text-sm text-warning">Montant à vérifier</Text>
      ) : null}
    </View>
  );
}
