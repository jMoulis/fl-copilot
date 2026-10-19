import { useEffect, useRef } from "react";
import {
  Pressable,
  ScrollView,
  type LayoutChangeEvent,
  Text,
  View,
} from "react-native";
import { SectionCard } from "../components/ui";
import type { WastePublicationIssue } from "./waste-publication-validation";
export function ReceiptIssueSummary({
  issues,
  onLocate,
  published = false,
}: {
  published?: boolean;
  issues: readonly WastePublicationIssue[];
  onLocate(issue: WastePublicationIssue): void;
}) {
  return (
    <SectionCard
      title="Champs à corriger"
      description={
        published
          ? "Le ticket est publié ; ces saisies non enregistrées ne le modifient pas."
          : "Appuyez sur une correction pour rejoindre la section concernée. Aucune ligne n’a été publiée."
      }
    >
      {issues.map((issue, index) => (
        <Pressable
          key={`${issue.lineId ?? issue.field}:${index}`}
          accessibilityRole="button"
          accessibilityLabel={`${issue.lineIndex !== undefined ? `Ligne ${issue.lineIndex + 1}. ` : ""}${issue.message} Voir le champ à corriger`}
          onPress={() => onLocate(issue)}
          className="min-h-12 justify-center rounded-xl border border-critical bg-critical-soft p-3"
        >
          <Text className="text-sm leading-5 text-critical">
            {issue.lineIndex !== undefined
              ? `Ligne ${issue.lineIndex + 1} · ${issue.label ?? ""} : `
              : ""}
            {issue.message}
          </Text>
          <Text className="mt-1 text-sm font-semibold text-ink">
            Voir la correction
          </Text>
        </Pressable>
      ))}
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
          : sectionTop.current[
              ["date", "cashierNumber", "duplicate"].includes(issue.field)
                ? issue.field
                : "processing"
            ];
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
    locate: (issue: WastePublicationIssue) => {
      pendingIssue.current = issue;
      scrollPending();
    },
  };
}

/** Source measurements stay separate: no sum of kg/pieces and no missing value turned into zero. */
export function ReceiptLinePreview({
  draft,
}: {
  draft: import("./waste-receipt-repository").LocalWasteLineDraft;
}) {
  const l = draft.line,
    decimal = (s: string) => s.replace(".", ",");
  return (
    <View className="gap-1 rounded-xl border border-line bg-canvas p-3">
      <Text className="font-semibold text-ink">
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
        {l.weight != null
          ? `Poids : ${decimal(l.weight)} kg`
          : "Poids non renseigné"}
        {l.quantity != null
          ? ` · Quantité : ${decimal(l.quantity)} (${l.quantityUnit === "PIECE" ? "pièces" : l.quantityUnit === "PACK" ? "unités conditionnées" : l.quantityUnit === "KG" ? "kg" : "unité à préciser"})`
          : ""}
      </Text>
      <Text className="text-sm text-ink">
        {l.unitPrice != null
          ? `Prix unitaire : ${decimal(l.unitPrice)} €`
          : "Prix unitaire non renseigné"}
      </Text>
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
