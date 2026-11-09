import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  commercialTgPresentationSchema,
  resizeTgPresentationZone,
  type CommercialWeekPreparation,
} from "@fl-copilot/domain";
import { BottomSheet, PrimaryButton, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";

type Placement = CommercialWeekPreparation["placements"][number];
const fill = {
  ACCROCHE: colors.forestSoft,
  RELAIS: colors.infoSoft,
  GAMME: colors.warningSoft,
};
const role = {
  ACCROCHE: "Accroche",
  RELAIS: "Relais",
  GAMME: "Complément de gamme",
};

export function TgPresentationView({
  placements,
  onSharesChange,
  large = false,
}: {
  placements: readonly Placement[];
  onSharesChange?(placementId: string, shares: number[]): void;
  large?: boolean;
}) {
  const [editor, setEditor] = useState<{
    id: string;
    index: number;
    value: string;
  }>();
  const [error, setError] = useState<string>();
  const current = placements.find((p) => p.id === editor?.id);
  const presentation = current?.presentation;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {placements.map((p) => (
          <View
            key={p.id}
            style={{
              flexGrow: 1,
              flexBasis: large ? "100%" : "46%",
              minWidth: 125,
              gap: 8,
            }}
          >
            <Text style={{ color: colors.muted, fontSize: 12 }}>{p.label}</Text>
            <Text
              style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}
            >
              {p.theme || "Thème à préciser"}
            </Text>
            {p.presentation ? (
              <>
                <TgSurfaceMap
                  presentation={p.presentation}
                  large={large}
                  onChoose={
                    onSharesChange
                      ? (i) => {
                          setError(undefined);
                          setEditor({
                            id: p.id,
                            index: i,
                            value: String(p.presentation!.zones[i]!.sharePct),
                          });
                        }
                      : undefined
                  }
                />
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  Surface proposée · schéma indicatif
                </Text>
                {p.presentation.zones.map((z, i) => (
                  <Pressable
                    key={`${i}:legend`}
                    disabled={!onSharesChange}
                    accessibilityRole={onSharesChange ? "button" : "text"}
                    onPress={() => {
                      setError(undefined);
                      setEditor({
                        id: p.id,
                        index: i,
                        value: String(z.sharePct),
                      });
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      minHeight: 36,
                    }}
                  >
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        backgroundColor: fill[z.role],
                      }}
                    />
                    <Text style={{ flex: 1, color: colors.ink, fontSize: 12 }}>
                      {z.label}
                    </Text>
                    <Text
                      style={{
                        color: colors.ink,
                        fontSize: 12,
                        fontWeight: "600",
                      }}
                    >
                      {z.sharePct}%
                    </Text>
                  </Pressable>
                ))}
                {p.presentation.counterPromotion ? (
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: colors.line,
                      paddingTop: 10,
                      gap: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.forest,
                        fontWeight: "600",
                        fontSize: 12,
                      }}
                    >
                      À proximité, hors TG
                    </Text>
                    <Text style={{ color: colors.ink, fontSize: 13 }}>
                      {p.presentation.counterPromotion.label}
                    </Text>
                  </View>
                ) : null}
                <SecondaryButton
                  label="Pourquoi ce choix ?"
                  onPress={() => {
                    setError(undefined);
                    setEditor({ id: p.id, index: -1, value: "" });
                  }}
                />
              </>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Répartition non précisée
              </Text>
            )}
          </View>
        ))}
      </View>
      {editor && current && presentation ? (
        <BottomSheet
          visible
          swipeToClose
          avoidKeyboard
          title={
            editor.index < 0
              ? current.theme || current.label
              : `Ajuster · ${presentation.zones[editor.index]!.label}`
          }
          onClose={() => setEditor(undefined)}
        >
          {editor.index < 0 ? (
            <>
              <Text style={{ color: colors.ink }}>
                {presentation.reason ||
                  "Proposition à adapter aux produits disponibles."}
              </Text>
              {presentation.counterPromotion ? (
                <Text style={{ color: colors.ink }}>
                  Contre-promo hors TG : {presentation.counterPromotion.label}.{" "}
                  {presentation.counterPromotion.reason}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={{ color: colors.muted }}>
                Part de la surface de présentation. Les autres zones s’ajustent
                pour garder 100 %. Ce n’est pas une quantité à commander.
              </Text>
              <TextInput
                accessibilityLabel="Part de surface proposée en pourcentage"
                keyboardType="number-pad"
                value={editor.value}
                onChangeText={(value) => setEditor({ ...editor, value })}
                style={{
                  color: colors.ink,
                  borderColor: colors.line,
                  borderWidth: 1,
                  borderRadius: 12,
                  padding: 12,
                  fontSize: 20,
                }}
              />
              {error ? (
                <Text
                  accessibilityRole="alert"
                  style={{ color: colors.critical }}
                >
                  {error}
                </Text>
              ) : null}
              <PrimaryButton
                label="Appliquer à la proposition"
                onPress={() => {
                  try {
                    if (!/^\d{1,3}$/.test(editor.value)) throw Error();
                    const next = resizeTgPresentationZone(
                      commercialTgPresentationSchema.parse(presentation),
                      editor.index,
                      Number(editor.value),
                    );
                    onSharesChange?.(
                      current.id,
                      next.zones.map((z) => z.sharePct),
                    );
                    setEditor(undefined);
                  } catch {
                    setError(
                      `Saisis une part entre ${presentation.zones.length === 1 ? 100 : 1} et ${101 - presentation.zones.length} %. Chaque produit conserve une zone.`,
                    );
                  }
                }}
              />
            </>
          )}
        </BottomSheet>
      ) : null}
    </View>
  );
}

function TgSurfaceMap({
  presentation,
  large,
  onChoose,
}: {
  presentation: NonNullable<Placement["presentation"]>;
  large: boolean;
  onChoose?(i: number): void;
}) {
  const zones = presentation.zones;
  const first = zones.reduce(
    (best, z, i) => (z.sharePct > zones[best]!.sharePct ? i : best),
    0,
  );
  const block = (i: number) => (
    <Pressable
      key={i}
      disabled={!onChoose}
      accessibilityRole={onChoose ? "button" : "text"}
      accessibilityLabel={`${zones[i]!.label}, ${zones[i]!.sharePct} pour cent de surface proposée, ${role[zones[i]!.role]}`}
      onPress={() => onChoose?.(i)}
      style={{
        flex: zones[i]!.sharePct,
        backgroundColor: fill[zones[i]!.role],
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        paddingHorizontal: 3,
        overflow: "hidden",
      }}
    >
      {zones.length <= 3 || zones[i]!.sharePct >= 20 ? (
        <>
          <Text
            style={{
              color: colors.ink,
              fontSize: large ? 22 : 15,
              fontWeight: "700",
            }}
          >
            {zones[i]!.sharePct}%
          </Text>
          <Text
            numberOfLines={2}
            style={{
              color: colors.ink,
              fontSize: large ? 14 : 11,
              textAlign: "center",
            }}
          >
            {zones[i]!.label}
          </Text>
        </>
      ) : null}
    </Pressable>
  );
  return (
    <View
      accessibilityLabel="Répartition proposée, total 100 pour cent de surface"
      style={{ height: large ? 260 : 210, flexDirection: "row", gap: 3 }}
    >
      {block(first)}
      {zones.length > 1 ? (
        <View style={{ flex: 100 - zones[first]!.sharePct, gap: 3 }}>
          {zones.map((_, i) => (i !== first ? block(i) : null))}
        </View>
      ) : null}
    </View>
  );
}
