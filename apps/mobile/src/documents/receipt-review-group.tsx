import type { ReactNode } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { SecondaryButton, SectionCard } from "../components/ui";
import { ReceiptLinePreview } from "./receipt-issue-summary";
import type { LocalWasteLineDraft } from "./waste-receipt-repository";

/** Presentation only. The receipt owns the selected UUID and every unsaved field. */
export function ReceiptReviewGroup({
  label,
  lines,
  activeLineId,
  onOpenLine,
  renderLine,
  onLayout,
  hasUnsavedChanges,
  needsReview,
  issueCount,
  disabled,
}: {
  label: string;
  lines: readonly LocalWasteLineDraft[];
  activeLineId?: string;
  onOpenLine(id: string | undefined): void;
  renderLine(line: LocalWasteLineDraft): ReactNode;
  onLayout(e: LayoutChangeEvent): void;
  hasUnsavedChanges: boolean;
  needsReview: boolean;
  issueCount: number;
  disabled: boolean;
}) {
  const index = lines.findIndex((d) => d.line.id === activeLineId);
  const selected = lines[index];
  const first =
    lines.find((d) => d.line.validationStatus === "TO_REVIEW") ?? lines[0];
  return (
    <SectionCard
      onLayout={onLayout}
      title={label}
      description={`${lines.length} occurrence${lines.length > 1 ? "s" : ""}`}
    >
      {issueCount ? (
        <Text className="text-sm font-semibold text-critical">
          {issueCount} champ{issueCount > 1 ? "s" : ""} à corriger
        </Text>
      ) : needsReview ? (
        <Text className="text-sm font-semibold text-warning">À examiner</Text>
      ) : null}
      {hasUnsavedChanges ? (
        <Text className="text-sm text-warning">
          Corrections non enregistrées · conservées pendant la navigation dans
          ce ticket.
        </Text>
      ) : null}
      {!selected ? (
        <>
          {lines.slice(0, 2).map((d) => (
            <ReceiptLinePreview key={d.line.id} draft={d} compact />
          ))}
          {lines.length > 2 ? (
            <Text className="text-sm text-muted">
              {lines.length - 2} autre{lines.length - 2 > 1 ? "s" : ""}{" "}
              occurrence{lines.length - 2 > 1 ? "s" : ""} dans le détail.
            </Text>
          ) : null}
        </>
      ) : null}
      <SecondaryButton
        label={
          selected
            ? "Replier la ligne"
            : lines.length === 1
              ? "Examiner cette ligne"
              : "Examiner les occurrences"
        }
        accessibilityLabel={`${selected ? "Replier" : "Examiner"} ${label}`}
        expanded={!!selected}
        disabled={disabled}
        onPress={() => onOpenLine(selected ? undefined : first?.line.id)}
      />
      {selected ? (
        <>
          {lines.length > 1 ? (
            <View className="gap-2">
              <Text
                accessibilityLiveRegion="polite"
                className="text-sm font-semibold text-ink"
              >
                Occurrence {index + 1} sur {lines.length} · Ligne source{" "}
                {selected.line.sourceLineIndex + 1}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <View className="grow" style={{ flexBasis: 130 }}>
                  <SecondaryButton
                    label="Précédente"
                    accessibilityLabel={`Occurrence précédente de ${label}`}
                    disabled={disabled || index === 0}
                    onPress={() => onOpenLine(lines[index - 1]?.line.id)}
                  />
                </View>
                <View className="grow" style={{ flexBasis: 130 }}>
                  <SecondaryButton
                    label="Suivante"
                    accessibilityLabel={`Occurrence suivante de ${label}`}
                    disabled={disabled || index === lines.length - 1}
                    onPress={() => onOpenLine(lines[index + 1]?.line.id)}
                  />
                </View>
              </View>
            </View>
          ) : null}
          {renderLine(selected)}
        </>
      ) : null}
    </SectionCard>
  );
}
