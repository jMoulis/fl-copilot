import { Text, TextInput, View } from "react-native";
import {
  storeEventTimeCandidates,
  storeEventTimeLabel,
} from "@fl-copilot/domain";
import { DateSelector } from "@/components/date-selector";
import { SecondaryButton } from "@/components/ui";
export type StoreEventTimeInput = {
  date: string;
  time: string;
  occurrence?: string;
};
export function StoreEventTimeField({
  label,
  value,
  onChange,
  disabled = false,
  issue,
}: {
  label: string;
  value: StoreEventTimeInput;
  onChange(v: StoreEventTimeInput): void;
  disabled?: boolean;
  issue?: string;
}) {
  let candidates: string[] = [];
  try {
    candidates = storeEventTimeCandidates(value.date, value.time);
  } catch {
    /* partial typing is validated on explicit save */
  }
  return (
    <View className="gap-2">
      <Text className="font-semibold text-ink">
        {label} · heure du magasin (Europe/Paris)
      </Text>
      <View pointerEvents={disabled ? "none" : "auto"}>
        <DateSelector
          disabled={disabled}
          label={`Date de ${label.toLocaleLowerCase("fr-FR")}`}
          description="Choisissez la date réelle de l’observation magasin."
          value={value.date}
          issue={issue}
          onConfirm={(date) =>
            onChange({ ...value, date, occurrence: undefined })
          }
        />
      </View>
      <TextInput
        accessibilityLabel={`Heure de ${label.toLocaleLowerCase("fr-FR")}, format 24 heures`}
        placeholder="HH:MM"
        value={value.time}
        onChangeText={(time) =>
          onChange({ ...value, time, occurrence: undefined })
        }
        editable={!disabled}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        className={`rounded-xl border p-3 text-ink ${issue ? "border-danger" : "border-line"}`}
      />
      {candidates.length > 1 ? (
        <>
          <Text className="text-muted">
            Cette heure existe deux fois lors du changement d’heure. Précisez le
            passage observé.
          </Text>
          {candidates.map((instant, i) => (
            <SecondaryButton
              key={instant}
              label={`${value.occurrence === instant ? "✓ " : ""}${i === 0 ? "Premier passage (heure d’été)" : "Second passage (heure d’hiver)"} · ${storeEventTimeLabel(instant)}`}
              disabled={disabled}
              onPress={() => onChange({ ...value, occurrence: instant })}
            />
          ))}
        </>
      ) : null}
      {issue ? (
        <Text accessibilityRole="alert" className="text-danger">
          {issue}
        </Text>
      ) : null}
    </View>
  );
}
