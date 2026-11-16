import { useRef, useState, type ReactNode } from "react";
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
  ACCROCHE: colors.hero,
  RELAIS: colors.accent,
  GAMME: colors.warningSoft,
};
const fillInk = {
  ACCROCHE: colors.heroInk,
  RELAIS: colors.onAccent,
  GAMME: colors.ink,
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
  layout = "compact",
  onOpenPlacement,
  renderFooter,
}: {
  placements: readonly Placement[];
  onSharesChange?(placementId: string, shares: number[]): void;
  large?: boolean;
  layout?: "compact" | "cards" | "detail";
  onOpenPlacement?(placementId: string): void;
  renderFooter?(placement: Placement): ReactNode;
}) {
  const [editor, setEditor] = useState<{
    id: string;
    index: number;
    value: string;
  }>();
  const [editorOpen, setEditorOpen] = useState(false);
  const editorOpenRef = useRef(false);
  const [error, setError] = useState<string>();
  function openEditor(value: NonNullable<typeof editor>) {
    editorOpenRef.current = true;
    setEditorOpen(true);
    setError(undefined);
    setEditor(value);
  }
  function closeEditor() {
    editorOpenRef.current = false;
    setEditorOpen(false);
  }
  const current = placements.find((p) => p.id === editor?.id);
  const presentation = current?.presentation;
  if (layout !== "compact")
    return (
      <TgJourneyPresentation
        placements={placements}
        layout={layout}
        onOpenPlacement={onOpenPlacement}
        renderFooter={renderFooter}
      />
    );
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
              gap: 9,
              padding: 14,
              borderRadius: 20,
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ color: colors.muted, fontSize: 12 }}>{p.label}</Text>
            <Text
              style={{
                color: colors.ink,
                fontSize: 18,
                lineHeight: 24,
                fontWeight: "700",
              }}
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
                          openEditor({
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
                      openEditor({
                        id: p.id,
                        index: i,
                        value: String(z.sharePct),
                      });
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      minHeight: onSharesChange ? 44 : 36,
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
                    openEditor({ id: p.id, index: -1, value: "" });
                  }}
                />
              </>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Répartition non précisée
              </Text>
            )}
            {renderFooter?.(p)}
          </View>
        ))}
      </View>
      {editor && current && presentation ? (
        <BottomSheet
          visible={editorOpen}
          swipeToClose
          avoidKeyboard
          title={
            editor.index < 0
              ? current.theme || current.label
              : `Ajuster · ${presentation.zones[editor.index]!.label}`
          }
          onClose={closeEditor}
          onDismiss={() => {
            if (!editorOpenRef.current) setEditor(undefined);
          }}
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
                editable={editorOpen}
                onChangeText={(value) => {
                  if (editorOpenRef.current) setEditor({ ...editor, value });
                }}
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
                disabled={!editorOpen}
                onPress={() => {
                  if (!editorOpenRef.current) return;
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
                    closeEditor();
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

/** Read-only journey views: the host owns opening a TG and declaring its execution. */
function TgJourneyPresentation({
  placements,
  layout,
  onOpenPlacement,
  renderFooter,
}: {
  placements: readonly Placement[];
  layout: "cards" | "detail";
  onOpenPlacement?(placementId: string): void;
  renderFooter?(placement: Placement): ReactNode;
}) {
  const [explainedId, setExplainedId] = useState<string>();
  const explained = placements.find((p) => p.id === explainedId);
  const detail = layout === "detail";
  return (
    <View style={{ gap: 20, width: "100%", minWidth: 0 }}>
      {placements.map((p) => {
        const heading = (
          <Text
            accessibilityRole="header"
            style={{
              flex: !detail && onOpenPlacement ? 1 : undefined,
              minWidth: 0,
              color: colors.ink,
              fontSize: detail ? 26 : 23,
              lineHeight: detail ? 31 : 28,
              letterSpacing: -0.6,
              fontWeight: "600",
            }}
          >
            {p.label}
          </Text>
        );
        const map = p.presentation ? (
          <TgSurfaceMap
            presentation={p.presentation}
            large={detail}
            percentageOnly
          />
        ) : null;
        return (
          <View
            key={p.id}
            style={{
              width: "100%",
              minWidth: 0,
              padding: detail ? 16 : 18,
              gap: 14,
              borderRadius: 24,
              backgroundColor: colors.surface,
            }}
          >
            {!detail && onOpenPlacement ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Ouvrir la TG ${p.label}`}
                onPress={() => onOpenPlacement(p.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: 44,
                  gap: 12,
                }}
              >
                {heading}
                <Text
                  accessible={false}
                  style={{ color: colors.forest, fontSize: 28 }}
                >
                  ›
                </Text>
              </Pressable>
            ) : (
              heading
            )}
            {map ? (
              <>
                {!detail && onOpenPlacement ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Ouvrir la répartition de la TG ${p.label}`}
                    onPress={() => onOpenPlacement(p.id)}
                    style={{ minHeight: 44 }}
                  >
                    {map}
                  </Pressable>
                ) : (
                  map
                )}
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  Surface proposée · schéma indicatif
                </Text>
                <View style={{ gap: 12 }}>
                  {p.presentation!.zones.map((z, i) => (
                    <View
                      key={i}
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 9,
                        minWidth: 0,
                      }}
                    >
                      <View
                        accessible={false}
                        style={{
                          width: 8,
                          height: 8,
                          marginTop: 6,
                          borderRadius: 2,
                          backgroundColor: fill[z.role],
                        }}
                      />
                      <Text
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: colors.ink,
                          fontSize: detail ? 16 : 14,
                          lineHeight: detail ? 24 : 21,
                        }}
                      >
                        {z.label}
                      </Text>
                      <Text
                        style={{
                          color: colors.ink,
                          fontSize: detail ? 16 : 14,
                          lineHeight: detail ? 24 : 21,
                          fontWeight: "600",
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {z.sharePct} %
                      </Text>
                    </View>
                  ))}
                </View>
                {detail && p.presentation!.counterPromotion ? (
                  <View
                    style={{
                      gap: 6,
                      paddingTop: 14,
                      borderTopWidth: 1,
                      borderTopColor: colors.line,
                    }}
                  >
                    <Text style={{ color: colors.forest, fontSize: 12 }}>
                      À proximité, hors TG
                    </Text>
                    <Text
                      style={{
                        color: colors.ink,
                        fontSize: 16,
                        lineHeight: 24,
                      }}
                    >
                      {p.presentation!.counterPromotion.label}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 14 }}>
                Répartition non précisée
              </Text>
            )}
            {(detail || !onOpenPlacement) &&
            (p.theme ||
              p.presentation?.reason ||
              p.presentation?.counterPromotion) ? (
              <SecondaryButton
                label="Pourquoi cette présentation ?"
                onPress={() => setExplainedId(p.id)}
              />
            ) : null}
            {renderFooter?.(p)}
          </View>
        );
      })}
      <BottomSheet
        visible={!!explained}
        title={explained?.label ?? "Présentation de la TG"}
        onClose={() => setExplainedId(undefined)}
        swipeToClose
      >
        {explained?.theme ? (
          <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 25 }}>
            {explained.theme}
          </Text>
        ) : null}
        {explained?.presentation?.reason &&
        explained.presentation.reason.trim() !== explained.theme?.trim() ? (
          <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 25 }}>
            {explained.presentation.reason}
          </Text>
        ) : null}
        {explained?.presentation?.counterPromotion ? (
          <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 25 }}>
            Contre-promo hors TG :{" "}
            {explained.presentation.counterPromotion.label}.{" "}
            {explained.presentation.counterPromotion.reason}
          </Text>
        ) : null}
      </BottomSheet>
    </View>
  );
}

function TgSurfaceMap({
  presentation,
  large,
  onChoose,
  percentageOnly = false,
}: {
  presentation: NonNullable<Placement["presentation"]>;
  large: boolean;
  onChoose?(i: number): void;
  percentageOnly?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const zones = presentation.zones;
  const first = zones.reduce(
    (best, z, i) => (z.sharePct > zones[best]!.sharePct ? i : best),
    0,
  );
  const height = percentageOnly ? (large ? 216 : 136) : large ? 260 : 154;
  const mapWidth = Math.max(0, width - (zones.length > 1 ? 3 : 0));
  const block = (i: number) => {
    if (percentageOnly) {
      const firstBlock = i === first;
      const zoneWidth =
        (mapWidth *
          (firstBlock
            ? zones[first]!.sharePct
            : 100 - zones[first]!.sharePct)) /
        100;
      const zoneHeight = firstBlock
        ? height
        : ((height - Math.max(0, zones.length - 2) * 3) * zones[i]!.sharePct) /
          (100 - zones[first]!.sharePct);
      return (
        <View
          key={i}
          accessible={false}
          style={{
            flex: zones[i]!.sharePct,
            minWidth: 0,
            backgroundColor: fill[zones[i]!.role],
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {zoneWidth >= 32 && zoneHeight >= 25 ? (
            <Text
              accessible={false}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={{
                maxWidth: "100%",
                paddingHorizontal: 3,
                color: fillInk[zones[i]!.role],
                fontSize: large ? 32 : 26,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
              }}
            >
              {zones[i]!.sharePct}%
            </Text>
          ) : null}
        </View>
      );
    }
    return (
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
                color: fillInk[zones[i]!.role],
                fontSize: large ? 22 : 15,
                fontWeight: "700",
              }}
            >
              {zones[i]!.sharePct}%
            </Text>
            <Text
              numberOfLines={2}
              style={{
                color: fillInk[zones[i]!.role],
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
  };
  return (
    <View
      accessibilityLabel={
        percentageOnly
          ? `Répartition proposée, total 100 pour cent de surface. ${zones.map((z) => `${z.label} : ${z.sharePct} pour cent`).join(". ")}`
          : "Répartition proposée, total 100 pour cent de surface"
      }
      onLayout={
        percentageOnly
          ? (event) => setWidth(event.nativeEvent.layout.width)
          : undefined
      }
      style={{ height, flexDirection: "row", gap: 3 }}
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
