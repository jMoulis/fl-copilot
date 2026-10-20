import { forwardRef } from "react";
import { StyleSheet, Text, type TextProps } from "react-native";
import { colors } from "../design/tokens";

/** Explicit-style chat cards share readable defaults; status/button styles still take precedence. */
export const ChatText = forwardRef<Text, TextProps>(function ChatText(
  { style, ...props },
  ref,
) {
  return <Text ref={ref} {...props} style={[styles.body, style]} />;
});
const styles = StyleSheet.create({
  body: { color: colors.ink, fontSize: 15, lineHeight: 22 },
});
