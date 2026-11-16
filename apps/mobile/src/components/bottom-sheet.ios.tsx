import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
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
  const [presented, setPresented] = useState(visible);
  const closing = useRef(false);
  const current = useRef({ visible, onClose, onDismiss });
  current.current = { visible, onClose, onDismiss };
  const contents = useRef({ title, footer, children });
  if (visible && !closing.current)
    contents.current = { title, footer, children };
  useEffect(() => {
    if (closing.current) return;
    if (visible) setPresented(true);
    else if (presented) {
      closing.current = true;
      setPresented(false);
    }
  }, [visible, presented]);

  return (
    <Host
      style={{ position: "absolute" }}
      pointerEvents="none"
      colorScheme="light"
    >
      <NativeBottomSheet
        isPresented={presented}
        onIsPresentedChange={(next) => {
          if (next || closing.current) return;
          closing.current = true;
          setPresented(false);
          current.current.onClose();
        }}
        onDismiss={() => {
          if (!closing.current) return;
          closing.current = false;
          current.current.onDismiss?.();
          if (current.current.visible) setPresented(true);
          else
            contents.current = { title: "", footer: undefined, children: null };
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
