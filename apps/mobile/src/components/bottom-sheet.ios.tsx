import { useEffect, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import {
  BottomSheet as NativeBottomSheet,
  Group,
  Host,
  RNHostView,
} from "@expo/ui/swift-ui";
import {
  frame,
  interactiveDismissDisabled,
  presentationBackground,
  presentationCornerRadius,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import { colors } from "../design/tokens";
import { BottomSheetContent } from "./bottom-sheet-content";
import type { BottomSheetProps } from "./bottom-sheet-props";

/** iOS owns the gesture, rebound, dimming and presentation; React owns the form. */
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
  const { width, height } = useWindowDimensions();
  const [presented, setPresented] = useState(visible);
  const [retained, setRetained] = useState(visible);
  const lifecycle = useRef({ closing: false, finished: false });
  const cycle = lifecycle.current;
  const current = useRef({ visible, onClose, onDismiss });
  current.current = { visible, onClose, onDismiss };
  const contents = useRef({ title, footer, children });
  if (visible && !cycle.closing && !cycle.finished)
    contents.current = { title, footer, children };
  useEffect(() => {
    if (lifecycle.current.closing) return;
    if (visible && !retained) {
      lifecycle.current = { closing: false, finished: false };
      setRetained(true);
      setPresented(true);
    } else if (presented) {
      if (!visible) {
        lifecycle.current.closing = true;
        setPresented(false);
      }
    }
  }, [visible, presented, retained]);

  // A dismissed presenter must leave the native hierarchy. Keeping every Host
  // alive retains native presentation/touch state across unrelated panels.
  if (!retained) return null;

  return (
    <Host
      style={{ position: "absolute", top: 0, left: 0, width, height }}
      pointerEvents="none"
      colorScheme="light"
    >
      <NativeBottomSheet
        isPresented={presented}
        onIsPresentedChange={(next) => {
          if (next || cycle.closing || cycle.finished) return;
          cycle.closing = true;
          setPresented(false);
          current.current.onClose();
        }}
        onDismiss={() => {
          // Native completion is authoritative. A swipe may complete before
          // its state-change event reaches JS, or without that earlier event.
          if (cycle.finished) return;
          const notifyClose = !cycle.closing && current.current.visible;
          cycle.finished = true;
          cycle.closing = false;
          setPresented(false);
          setRetained(false);
          contents.current = { title: "", footer: undefined, children: null };
          if (notifyClose) current.current.onClose();
          current.current.onDismiss?.();
        }}
      >
        <Group
          modifiers={[
            frame({
              maxWidth: Infinity,
              maxHeight: Infinity,
              alignment: "topLeading",
            }),
            presentationDetents(["medium", "large"]),
            presentationBackground(colors.surface),
            presentationCornerRadius(28),
            presentationDragIndicator(swipeToClose ? "visible" : "hidden"),
            interactiveDismissDisabled(!swipeToClose || !dismissible),
          ]}
        >
          <RNHostView>
            <View
              pointerEvents={visible && presented ? "auto" : "none"}
              style={{ flex: 1 }}
            >
              <BottomSheetContent
                {...contents.current}
                onClose={onClose}
                scrollRef={scrollRef}
                avoidKeyboard={visible && presented && avoidKeyboard}
                fill
              />
            </View>
          </RNHostView>
        </Group>
      </NativeBottomSheet>
    </Host>
  );
}
