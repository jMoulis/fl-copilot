import type { PropsWithChildren, ReactNode, Ref } from "react";
import type { ScrollView } from "react-native";

export type BottomSheetProps = PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose(): void;
  onDismiss?(): void;
  swipeToClose?: boolean;
  /** Prevent interactive dismissal while an existing owner guard would refuse it. X still requests close. */
  dismissible?: boolean;
  avoidKeyboard?: boolean;
  scrollRef?: Ref<ScrollView>;
  footer?: ReactNode;
}>;
