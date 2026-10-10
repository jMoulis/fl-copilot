import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { colors } from "@/design/tokens";
import { PrimaryButton, SecondaryButton } from "./ui";
import {
  calendarCells,
  calendarDate,
  calendarMonthLabel,
  formatFrenchCalendarDate,
  shiftCalendarMonth,
  todayCalendarDate,
} from "@/dates/calendar";

export function DateSelector({
  value,
  onConfirm,
  issue,
  disabled = false,
  label = "Date de casse",
  description = "Choisissez la date imprimée en bas du ticket.",
}: {
  value: string;
  onConfirm(value: string): void;
  disabled?: boolean;
  issue?: string;
  label?: string;
  description?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState("");
  const [month, setMonth] = useState(todayCalendarDate().slice(0, 7));
  const { width } = useWindowDimensions();
  const open = () => {
    const initial = calendarDate(value) ? value : todayCalendarDate();
    setSelected(initial);
    setMonth(initial.slice(0, 7));
    setVisible(true);
  };
  return (
    <>
      <Pressable
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${formatFrenchCalendarDate(value)}`}
        accessibilityHint={issue ?? description}
        onPress={open}
        className={`min-h-12 justify-center rounded-xl border px-4 py-3 ${issue ? "border-critical bg-critical-soft" : "border-line bg-canvas"}`}
      >
        <Text className="text-base text-ink">
          {formatFrenchCalendarDate(value)}
        </Text>
        <Text className="text-sm text-muted">Ouvrir le calendrier</Text>
      </Pressable>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: colors.overlay,
          }}
        >
          <View
            accessibilityViewIsModal
            style={{
              width: "98%",
              maxWidth: 420,
              maxHeight: "90%",
              backgroundColor: colors.surface,
              borderRadius: 20,
              padding: width < 360 ? 2 : 12,
            }}
          >
            <ScrollView
              contentContainerStyle={{ gap: 16, paddingVertical: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text
                accessibilityRole="header"
                className="px-2 text-xl font-semibold text-ink"
              >
                {label}
              </Text>
              <Text className="px-2 text-sm text-muted">{description}</Text>
              <View className="flex-row items-center justify-between gap-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mois précédent"
                  onPress={() =>
                    setMonth((current) => shiftCalendarMonth(current, -1))
                  }
                  className="min-h-12 min-w-12 items-center justify-center rounded-xl border border-line"
                >
                  <Text className="text-xl text-forest">‹</Text>
                </Pressable>
                <Text
                  accessibilityRole="header"
                  className="flex-1 text-center text-base font-semibold text-ink"
                >
                  {calendarMonthLabel(month)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mois suivant"
                  onPress={() =>
                    setMonth((current) => shiftCalendarMonth(current, 1))
                  }
                  className="min-h-12 min-w-12 items-center justify-center rounded-xl border border-line"
                >
                  <Text className="text-xl text-forest">›</Text>
                </Pressable>
              </View>
              <View className="flex-row">
                {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map(
                  (day) => (
                    <Text
                      key={day}
                      style={{
                        width: "14.285714%",
                        textAlign: "center",
                        color: colors.muted,
                      }}
                    >
                      {day}
                    </Text>
                  ),
                )}
              </View>
              <View className="flex-row flex-wrap">
                {calendarCells(month).map((day, index) =>
                  day ? (
                    <Pressable
                      key={day}
                      accessibilityRole="button"
                      accessibilityLabel={formatFrenchCalendarDate(day)}
                      accessibilityState={{ selected: day === selected }}
                      onPress={() => setSelected(day)}
                      style={{
                        width: "14.285714%",
                        minHeight: 48,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 12,
                        backgroundColor:
                          day === selected ? colors.forest : colors.surface,
                      }}
                    >
                      <Text
                        style={{
                          color: day === selected ? colors.surface : colors.ink,
                          fontSize: 16,
                          fontWeight: day === selected ? "700" : "400",
                        }}
                      >
                        {Number(day.slice(-2))}
                      </Text>
                    </Pressable>
                  ) : (
                    <View
                      key={`empty-${index}`}
                      style={{ width: "14.285714%", minHeight: 48 }}
                    />
                  ),
                )}
              </View>
              <Text className="text-center text-base text-ink">
                Date choisie : {formatFrenchCalendarDate(selected)}
              </Text>
              <PrimaryButton
                label="Confirmer cette date"
                onPress={() => {
                  setVisible(false);
                  onConfirm(selected);
                }}
              />
              <SecondaryButton
                label="Annuler"
                onPress={() => setVisible(false)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
