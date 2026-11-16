import { useCallback, useEffect, useRef, type Ref } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type GestureResponderHandlers,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../design/tokens";
import type { BottomSheetProps } from "./bottom-sheet-props";

export function BottomSheetContent({
  title,
  onClose,
  children,
  footer,
  scrollRef,
  avoidKeyboard,
  showHandle = false,
  headerHandlers = {},
  headingRef,
  style,
  fill = false,
}: Pick<
  BottomSheetProps,
  "title" | "onClose" | "children" | "footer" | "scrollRef" | "avoidKeyboard"
> & {
  showHandle?: boolean;
  headerHandlers?: GestureResponderHandlers;
  headingRef?: Ref<Text>;
  style?: StyleProp<ViewStyle>;
  fill?: boolean;
}) {
  const body = useRef<ScrollView | null>(null);
  const focused =
    useRef<ReturnType<typeof TextInput.State.currentlyFocusedInput>>(null);
  const offset = useRef(0);
  const measurement = useRef(0);
  const keyboardForm = fill && avoidKeyboard;
  const attachBody = useCallback(
    (node: ScrollView | null) => {
      body.current = node;
      measurement.current++;
      if (typeof scrollRef === "function") return scrollRef(node);
      if (scrollRef) scrollRef.current = node;
    },
    [scrollRef],
  );

  // SwiftUI owns the keyboard safe area. Keep the field within the actual body,
  // whose bottom is above the fixed footer, rather than within the full window.
  const revealFocusedField = useCallback(() => {
    if (!keyboardForm) return;
    const field = focused.current;
    const scroll = body.current;
    if (!field || !scroll || TextInput.State.currentlyFocusedInput() !== field)
      return;
    const request = ++measurement.current;
    scroll.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
      field.measureInWindow((_fieldX, fieldTop, _fieldWidth, fieldHeight) => {
        if (
          measurement.current !== request ||
          body.current !== scroll ||
          focused.current !== field ||
          TextInput.State.currentlyFocusedInput() !== field ||
          height <= 0 ||
          fieldHeight <= 0
        )
          return;
        const margin = 20;
        const delta =
          fieldHeight > height - margin * 2 || fieldTop < top + margin
            ? fieldTop - top - margin
            : Math.max(0, fieldTop + fieldHeight - (top + height - margin));
        if (Math.abs(delta) > 1)
          scroll.scrollTo({
            y: Math.max(0, offset.current + delta),
            animated: false,
          });
      });
    });
  }, [keyboardForm]);
  useEffect(() => {
    // UIKit may finish its own focus scroll after the sheet's layout event.
    const listener = keyboardForm
      ? Keyboard.addListener("keyboardDidShow", revealFocusedField)
      : undefined;
    return () => {
      listener?.remove();
      focused.current = null;
    };
  }, [keyboardForm, revealFocusedField]);
  return (
    <View
      accessibilityViewIsModal
      onAccessibilityEscape={onClose}
      className="rounded-t-3xl bg-surface"
      style={[
        { flexShrink: 1, overflow: "hidden" },
        fill && { flex: 1 },
        style,
      ]}
    >
      {showHandle ? (
        <View
          {...headerHandlers}
          accessibilityLabel="Glisser vers le bas pour fermer"
          style={{
            height: 28,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.line,
            }}
          />
        </View>
      ) : null}
      <View
        {...(showHandle ? headerHandlers : {})}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 20,
          paddingTop: showHandle ? 0 : 16,
          paddingBottom: 14,
          borderBottomWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Text
          ref={headingRef}
          accessible
          accessibilityRole="header"
          numberOfLines={2}
          accessibilityLabel={title}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 21,
            fontWeight: "600",
            letterSpacing: -0.5,
            color: colors.ink,
          }}
        >
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Fermer le panneau : ${title}`}
          onPress={onClose}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surfaceMuted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name="close"
            size={22}
            color={colors.ink}
            accessible={false}
          />
        </Pressable>
      </View>
      <View style={fill ? { flex: 1, minHeight: 0 } : { flexShrink: 1 }}>
        <ScrollView
          ref={attachBody}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={avoidKeyboard ? "interactive" : "none"}
          onFocus={
            keyboardForm
              ? () => {
                  focused.current = TextInput.State.currentlyFocusedInput();
                  revealFocusedField();
                }
              : undefined
          }
          onBlur={
            keyboardForm
              ? () => {
                  focused.current = null;
                  measurement.current++;
                }
              : undefined
          }
          onLayout={keyboardForm ? revealFocusedField : undefined}
          onScroll={
            keyboardForm
              ? (event) => {
                  offset.current = event.nativeEvent.contentOffset.y;
                  measurement.current++;
                }
              : undefined
          }
          scrollEventThrottle={keyboardForm ? 16 : undefined}
          style={fill ? { flex: 1 } : { flexShrink: 1 }}
          contentContainerStyle={{ padding: 20, gap: 18 }}
        >
          {children}
        </ScrollView>
      </View>
      {footer ? (
        <View
          style={{
            paddingHorizontal: 20,
            paddingVertical: 14,
            borderTopWidth: 1,
            borderColor: colors.line,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
