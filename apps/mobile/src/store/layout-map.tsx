import { useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { StoreLayoutContent } from "@fl-copilot/domain";
import { colors } from "../design/tokens";
import {
  dragStoreLayoutObject,
  layoutDragHit,
  type LayoutMapFrame,
} from "./layout-drag";
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
  movement,
}: {
  content: StoreLayoutContent;
  annotations?: Readonly<Record<string, string>>;
  movement?: {
    onMove(before: StoreLayoutContent, after: StoreLayoutContent): boolean;
  };
  selectedId: string | null;
  viewport: LayoutViewport;
  onViewport: (v: LayoutViewport) => void;
  onSelect: (id: string) => void;
}) {
  const [width, setWidth] = useState(300),
    height = 350;
  const baseDrawing = useMemo(() => layoutDrawing(content), [content]);
  const [preview, setPreview] = useState<{
    before: StoreLayoutContent;
    after: StoreLayoutContent;
    id: string;
  } | null>(null);
  const [moveError, setMoveError] = useState<{
    id: string;
    text: string;
    content: StoreLayoutContent;
  }>();
  const drawing = useMemo(
    () =>
      preview &&
      movement &&
      preview.before === content &&
      preview.id === selectedId
        ? layoutDrawing(preview.after)
        : baseDrawing,
    [preview, movement, content, selectedId, baseDrawing],
  );
  // Keep the view's frame fixed during a gesture, even when a provisional move extends its drawing bounds.
  const factor = Math.min(
      (width - 32) / baseDrawing.width,
      (height - 52) / baseDrawing.height,
    ),
    ox = (width - baseDrawing.width * factor) / 2,
    oy = (height - baseDrawing.height * factor) / 2;
  const frame: LayoutMapFrame = { width, height, factor, ox, oy };
  const latest = useRef({
    content,
    viewport,
    onViewport,
    selectedId,
    movement,
    frame,
    baseDrawing,
  });
  latest.current = {
    content,
    viewport,
    onViewport,
    selectedId,
    movement,
    frame,
    baseDrawing,
  };
  const panStart = useRef(viewport),
    pinchStart = useRef(1);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{
    content: StoreLayoutContent;
    viewport: LayoutViewport;
    frame: LayoutMapFrame;
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const gesture = useMemo(() => {
    function currentDrag() {
      const d = dragStart.current,
        p = latest.current;
      return d &&
        p.movement &&
        p.selectedId === d.id &&
        p.content === d.content &&
        p.frame.width === d.frame.width &&
        p.frame.factor === d.frame.factor &&
        p.viewport.scale === d.viewport.scale &&
        p.viewport.x === d.viewport.x &&
        p.viewport.y === d.viewport.y
        ? { d, p }
        : null;
    }
    function failure(id: string, error: unknown) {
      setPreview(null);
      setMoveError({
        id,
        content: latest.current.content,
        text:
          error instanceof Error && !("issues" in error)
            ? error.message
            : "Ce déplacement ne peut pas être appliqué. Le brouillon reste inchangé ; vérifiez les positions de l’élément et des mobiles associés.",
      });
    }
    const pan = Gesture.Pan()
      .minDistance(8)
      .maxPointers(1)
      .runOnJS(true)
      .onBegin((e) => {
        touchStart.current = { x: e.x, y: e.y };
      })
      .onStart((e) => {
        const p = latest.current;
        panStart.current = p.viewport;
        dragStart.current = null;
        setPreview(null);
        setMoveError(undefined);
        const initial = touchStart.current ?? {
          x: e.x - e.translationX,
          y: e.y - e.translationY,
        };
        if (
          p.movement &&
          p.selectedId &&
          layoutDragHit(
            [...p.baseDrawing.groups, ...p.baseDrawing.fixtures],
            p.selectedId,
            p.frame,
            p.viewport,
            initial.x,
            initial.y,
          )
        )
          dragStart.current = {
            content: p.content,
            viewport: p.viewport,
            frame: p.frame,
            id: p.selectedId,
            offsetX: e.x - initial.x - e.translationX,
            offsetY: e.y - initial.y - e.translationY,
          };
      })
      .onUpdate((e) => {
        const p = latest.current;
        if (dragStart.current) {
          const active = currentDrag();
          if (!active) {
            setPreview(null);
            return;
          }
          const { d } = active;
          try {
            setPreview({
              before: d.content,
              after: dragStoreLayoutObject(
                d.content,
                d.id,
                e.translationX + d.offsetX,
                e.translationY + d.offsetY,
                d.frame,
                d.viewport,
              ),
              id: d.id,
            });
            setMoveError(undefined);
          } catch (error) {
            failure(d.id, error);
          }
          return;
        }
        p.onViewport(
          layoutViewport({
            ...p.viewport,
            x: panStart.current.x + e.translationX / p.frame.width,
            y: panStart.current.y + e.translationY / p.frame.height,
          }),
        );
      })
      .onEnd((e, success) => {
        const active = currentDrag();
        if (!success || !active) return;
        const { d, p } = active;
        try {
          const after = dragStoreLayoutObject(
            d.content,
            d.id,
            e.translationX + d.offsetX,
            e.translationY + d.offsetY,
            d.frame,
            d.viewport,
          );
          if (after !== d.content && !p.movement!.onMove(d.content, after))
            failure(
              d.id,
              Error(
                "Le plan ou vos droits ont changé. Aucun déplacement appliqué ; reprenez depuis le brouillon actuel.",
              ),
            );
        } catch (error) {
          failure(d.id, error);
        }
      })
      .onFinalize(() => {
        dragStart.current = null;
        touchStart.current = null;
        setPreview(null);
      });
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        dragStart.current = null;
        setPreview(null);
      })
      .onStart(() => {
        dragStart.current = null;
        setPreview(null);
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
                    borderWidth: g.id === selectedId ? 2 : 1,
                    borderRadius: 5,
                    borderColor:
                      g.id === selectedId ? colors.forest : colors.muted,
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
                    accessibilityLabel={`${movement ? "Sélectionner" : annotations ? "Repérer" : "Ouvrir"} ${f.label}${f.schematic ? ", repère schématique" : ""}${annotations?.[f.id] ? `, affectation ${annotations[f.id]}` : ""}`}
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
      {movement &&
      moveError?.id === selectedId &&
      moveError.content === content ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.critical, fontSize: 14 }}
        >
          {moveError.text}
        </Text>
      ) : null}
      <Text style={{ fontSize: 13, lineHeight: 19, color: colors.muted }}>
        {movement
          ? "Touchez un meuble pour le choisir, puis glissez l’élément sélectionné pour le placer. Glissez ailleurs pour explorer ; pincez pour zoomer. Les nouvelles positions restent déclarées dans le brouillon, jamais relevées sur place."
          : "Pincez pour zoomer, glissez pour explorer. Les meubles restent fixes."}
        {drawing.schematic
          ? " Les cases en pointillés sont des repères, sans dimensions déduites."
          : ""}
      </Text>
    </View>
  );
}
