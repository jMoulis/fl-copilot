import { useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { StoreLayoutContent } from "@fl-copilot/domain";
import { colors } from "../design/tokens";
import {
  layoutDrawing,
  layoutViewport,
  type LayoutViewport,
} from "./layout-view-model";
export function StoreLayoutMap({
  content,
  selectedId,
  viewport,
  onViewport,
  onSelect,
  annotations,
}: {
  content: StoreLayoutContent;
  annotations?: Readonly<Record<string, string>>;
  selectedId: string | null;
  viewport: LayoutViewport;
  onViewport: (v: LayoutViewport) => void;
  onSelect: (id: string) => void;
}) {
  const drawing = useMemo(() => layoutDrawing(content), [content]),
    [width, setWidth] = useState(300),
    height = 350;
  const latest = useRef({ viewport, onViewport, width });
  latest.current = { viewport, onViewport, width };
  const panStart = useRef(viewport),
    pinchStart = useRef(1);
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(8)
      .runOnJS(true)
      .onStart(() => {
        panStart.current = latest.current.viewport;
      })
      .onUpdate((e) => {
        const p = latest.current;
        const next = layoutViewport({
          ...p.viewport,
          x: panStart.current.x + e.translationX / p.width,
          y: panStart.current.y + e.translationY / height,
        });
        p.onViewport(next);
      });
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        pinchStart.current = latest.current.viewport.scale;
      })
      .onUpdate((e) => {
        const p = latest.current;
        p.onViewport(
          layoutViewport({
            ...p.viewport,
            scale: pinchStart.current * e.scale,
          }),
        );
      });
    return Gesture.Simultaneous(pan, pinch);
  }, []);
  const factor = Math.min(
      (width - 32) / drawing.width,
      (height - 52) / drawing.height,
    ),
    ox = (width - drawing.width * factor) / 2,
    oy = (height - drawing.height * factor) / 2;
  return (
    <View style={{ gap: 12 }}>
      <View
        onLayout={(e) => setWidth(Math.max(100, e.nativeEvent.layout.width))}
        style={{
          height,
          overflow: "hidden",
          backgroundColor: colors.canvas,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <GestureDetector gesture={gesture}>
          <View collapsable={false} style={{ flex: 1 }}>
            <View
              style={{
                width,
                height,
                transform: [
                  { translateX: viewport.x * width },
                  { translateY: viewport.y * height },
                  { scale: viewport.scale },
                ],
              }}
            >
              {drawing.roomKnown ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: ox,
                    top: oy,
                    width: content.room.width.mm! * factor,
                    height: content.room.depth.mm! * factor,
                    borderWidth: 1,
                    borderStyle: "dashed",
                    borderColor: colors.line,
                  }}
                />
              ) : null}
              {drawing.groups.map((g) => (
                <View
                  pointerEvents="none"
                  key={g.id}
                  style={{
                    position: "absolute",
                    left: ox + g.x * factor - 3,
                    top: oy + g.y * factor - 3,
                    width: g.width * factor + 6,
                    height: g.height * factor + 6,
                    borderWidth: 1,
                    borderRadius: 5,
                    borderColor: colors.muted,
                  }}
                >
                  <Text
                    style={{
                      position: "absolute",
                      top:
                        Math.max(4, oy + g.y * factor - 40) -
                        (oy + g.y * factor - 3),
                      left: 0,
                      fontSize: 12,
                      fontWeight: "600",
                      color: colors.ink,
                    }}
                  >
                    {g.label}
                  </Text>
                </View>
              ))}
              {drawing.fixtures.map((f) => {
                const source = content.furniture.find((x) => x.id === f.id)!,
                  selected = f.id === selectedId,
                  mobiles = content.furniture.filter((x) => x.hostId === f.id);
                const short =
                  source.kind === "FIXED"
                    ? `${source.face}${source.order}`
                    : source.label;
                return (
                  <Pressable
                    key={f.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${annotations ? "Repérer" : "Ouvrir"} ${f.label}${f.schematic ? ", repère schématique" : ""}${annotations?.[f.id] ? `, affectation ${annotations[f.id]}` : ""}`}
                    accessibilityState={{ selected }}
                    onPress={() => onSelect(f.id)}
                    style={{
                      position: "absolute",
                      zIndex: annotations?.[f.id] ? 2 : 0,
                      left: ox + f.x * factor + 2,
                      top: oy + f.y * factor + 2,
                      width: Math.max(8, f.width * factor - 4),
                      height: Math.max(8, f.height * factor - 4),
                      justifyContent: "center",
                      alignItems: "center",
                      borderRadius: 5,
                      borderWidth: selected ? 2 : 1,
                      borderStyle: f.schematic ? "dashed" : "solid",
                      borderColor: selected ? colors.forest : colors.muted,
                      backgroundColor: selected
                        ? colors.forest
                        : f.kind === "TG"
                          ? colors.warningSoft
                          : colors.forestSoft,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: source.kind === "FIXED" ? 10 : 12,
                        fontWeight: "600",
                        color: selected ? colors.surface : colors.ink,
                      }}
                    >
                      {short}
                    </Text>
                    {annotations?.[f.id] ? (
                      <Text
                        style={{
                          position: "absolute",
                          top: -9,
                          right: -9,
                          minWidth: 18,
                          height: 18,
                          paddingHorizontal: 3,
                          borderRadius: 9,
                          overflow: "hidden",
                          textAlign: "center",
                          lineHeight: 18,
                          backgroundColor: colors.forest,
                          fontSize: 10,
                          fontWeight: "700",
                          color: colors.surface,
                        }}
                      >
                        {annotations[f.id]}
                      </Text>
                    ) : null}
                    {mobiles.length ? (
                      <Text
                        style={{
                          fontSize: 10,
                          color: selected ? colors.surface : colors.forest,
                        }}
                      >
                        + {mobiles.length} mobile{mobiles.length > 1 ? "s" : ""}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </GestureDetector>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {(
          [
            {
              label: "Réduire le plan",
              text: "−",
              scale: viewport.scale / 1.4,
            },
            {
              label: "Agrandir le plan",
              text: "+",
              scale: viewport.scale * 1.4,
            },
          ] as const
        ).map((b) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={b.label}
            key={b.label}
            onPress={() =>
              onViewport(layoutViewport({ ...viewport, scale: b.scale }))
            }
            style={{
              minWidth: 48,
              minHeight: 48,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ fontSize: 24, color: colors.forest }}>{b.text}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Recentrer le plan"
          onPress={() => onViewport({ scale: 1, x: 0, y: 0 })}
          style={{ minHeight: 48, padding: 12, justifyContent: "center" }}
        >
          <Text style={{ color: colors.forest, fontWeight: "600" }}>
            Recentrer
          </Text>
        </Pressable>
        <Text style={{ marginLeft: "auto", color: colors.muted }}>
          {Math.round(viewport.scale * 100)} %
        </Text>
      </View>
      <Text style={{ fontSize: 13, lineHeight: 19, color: colors.muted }}>
        Pincez pour zoomer, glissez pour explorer. Les meubles restent fixes.
        {drawing.schematic
          ? " Les cases en pointillés sont des repères, sans dimensions déduites."
          : ""}
      </Text>
    </View>
  );
}
