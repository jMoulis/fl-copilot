import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  PanResponder,
  Pressable,
  Text,
  findNodeHandle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheetContent } from "./bottom-sheet-content";
import { colors } from "../design/tokens";
import type { BottomSheetProps } from "./bottom-sheet-props";

/** Existing Android/web presentation; iOS uses the native Expo sheet. */
export function BottomSheet({
  visible,
  title,
  onClose,
  onDismiss,
  swipeToClose = true,
  dismissible = true,
  avoidKeyboard = false,
  scrollRef,
  footer,
  children,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const heading = useRef<Text>(null);
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const waitingForDismiss = useRef(false);
  const [presented, setPresented] = useState(visible);
  const [shown, setShown] = useState(false);
  const [height, setHeight] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  // Several owners clear the selected item with visible=false. Keep its last
  // rendered contents for the exit without retaining a separate business draft.
  const lastContent = useRef({ title, children, footer });
  if (visible) lastContent.current = { title, children, footer };
  const content = visible ? { title, children, footer } : lastContent.current;
  const finishDismiss = useCallback(() => {
    if (!waitingForDismiss.current) return;
    waitingForDismiss.current = false;
    dismissRef.current?.();
    if (visibleRef.current) {
      setHeight(0);
      setPresented(true);
    } else
      lastContent.current = { title: "", children: null, footer: undefined };
  }, []);
  useEffect(() => {
    if (waitingForDismiss.current) return;
    if (visible && !presented) {
      setHeight(0);
      setPresented(true);
      return;
    }
    if (!presented || (visible && (!shown || !height))) return;
    let active = true;
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 280 : 220,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
      isInteraction: false,
    });
    animation.start(({ finished }) => {
      if (!active || !finished || visibleRef.current) return;
      waitingForDismiss.current = true;
      setShown(false);
      setPresented(false);
      // iOS owns the actual native dismissal event; the other platforms do not
      // provide that event, so completion follows the finished exit animation.
      if (Platform.OS !== "ios") finishDismiss();
    });
    return () => {
      active = false;
      animation.stop();
    };
  }, [visible, presented, shown, height, progress, finishDismiss]);
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) =>
          g.dy > 12 && g.dy > Math.abs(g.dx) * 1.2,
        onMoveShouldSetPanResponderCapture: (_, g) =>
          g.dy > 12 && g.dy > Math.abs(g.dx) * 1.2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, g) => {
          if (
            dismissibleRef.current &&
            g.dy > 70 &&
            g.dy > Math.abs(g.dx) * 1.2
          )
            closeRef.current();
        },
      }),
    [],
  );
  useEffect(() => {
    if (!visible || !shown || Platform.OS === "web") return;
    const timer = setTimeout(() => {
      const node = findNodeHandle(heading.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 280);
    return () => clearTimeout(timer);
  }, [visible, shown]);
  return (
    <Modal
      visible={presented}
      transparent
      animationType="none"
      onShow={() => setShown(true)}
      onRequestClose={onClose}
      onDismiss={finishDismiss}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: colors.sheetOverlay,
          opacity: progress,
        }}
      />
      <KeyboardAvoidingView
        pointerEvents={visible ? "auto" : "none"}
        enabled={avoidKeyboard && Platform.OS !== "web"}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{
          flex: 1,
          justifyContent: "flex-end",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Fermer : ${content.title}`}
          onPress={onClose}
          style={{ position: "absolute", inset: 0 }}
        />
        <Animated.View
          onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
          style={{
            maxHeight: "90%",
            opacity: height > 0 ? 1 : 0,
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [Math.max(1, height), 0],
                }),
              },
            ],
          }}
        >
          <BottomSheetContent
            {...content}
            onClose={onClose}
            scrollRef={scrollRef}
            avoidKeyboard={avoidKeyboard}
            showHandle={swipeToClose}
            headerHandlers={swipe.panHandlers}
            headingRef={heading}
            style={{
              paddingBottom: insets.bottom,
              paddingLeft: insets.left,
              paddingRight: insets.right,
            }}
          />
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
