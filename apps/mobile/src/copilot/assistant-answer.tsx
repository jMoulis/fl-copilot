import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, Text, View, StyleSheet } from "react-native";
import { BottomSheet } from "../components/ui";
import { colors } from "../design/tokens";
import { markdownBlocks } from "./markdown-blocks";
type Source = {
  label: string;
  value: string | number | null;
  sourceId: string;
};
/** Small native Markdown surface: no HTML, arbitrary URL navigation or webview. */
export function AssistantAnswer({
  text,
  renderSource,
}: {
  text: string;
  renderSource?(id: string): ReactNode;
}) {
  const [source, setSource] = useState<Source>();
  const blocks = useMemo(() => markdownBlocks(text), [text]);
  function openSource(encoded: string) {
    try {
      const value: unknown = JSON.parse(decodeURIComponent(encoded));
      if (!value || typeof value !== "object") return;
      const v = value as Source;
      if (
        typeof v.label === "string" &&
        v.label.length <= 1000 &&
        typeof v.sourceId === "string" &&
        (v.value === null ||
          typeof v.value === "number" ||
          typeof v.value === "string")
      )
        setSource(v);
    } catch {
      /* Partial citations become clickable only after their token closes. */
    }
  }
  function inline(value: string): ReactNode[] {
    return value
      .split(/(\*\*[^*]+\*\*|(?<!\\)\[[^\]]+\]\(copilot-source:[^)]+\))/g)
      .filter(Boolean)
      .map((part, i) => {
        const link = /^\[([^\]]+)\]\(copilot-source:([^)]+)\)$/.exec(part);
        if (link)
          return (
            <Text
              key={i}
              accessibilityRole="link"
              accessibilityLabel="Consulter la source"
              onPress={() => openSource(link[2]!)}
              style={styles.link}
            >
              {link[1]}
            </Text>
          );
        if (part.startsWith("**") && part.endsWith("**"))
          return (
            <Text key={i} style={styles.bold}>
              {part.slice(2, -2)}
            </Text>
          );
        return part.replace(/\\([\\`*_[\]|<>])/g, "$1");
      });
  }
  return (
    <View style={styles.answer}>
      {blocks.map((block, i) =>
        block.type === "table" ? (
          <ScrollView
            key={i}
            horizontal
            showsHorizontalScrollIndicator
            accessibilityLabel="Tableau de chiffres, faites défiler horizontalement"
            style={styles.tableScroll}
          >
            <View style={styles.table}>
              {block.rows.map((row, r) => (
                <View key={r} style={[styles.row, r === 0 && styles.header]}>
                  {row.map((cell, c) => (
                    <Text
                      key={c}
                      selectable
                      style={[styles.cell, r === 0 && styles.bold]}
                    >
                      {inline(cell)}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        ) : (
          <Text
            key={i}
            selectable
            style={[styles.text, block.type === "heading" && styles.heading]}
          >
            {block.type === "list" ? "• " : ""}
            {inline(block.text)}
          </Text>
        ),
      )}
      <BottomSheet
        visible={!!source}
        title="Source"
        onClose={() => setSource(undefined)}
      >
        {source ? (
          <View style={styles.answer}>
            <Text selectable style={styles.bold}>
              {source.label}
            </Text>
            <Text selectable style={styles.text}>
              {source.value === null
                ? "Valeur non disponible"
                : String(source.value)}
            </Text>
            {renderSource?.(source.sourceId)}
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}
const styles = StyleSheet.create({
  answer: { gap: 14 },
  text: { fontSize: 17, lineHeight: 26, color: colors.ink },
  heading: { fontSize: 19, fontWeight: "600" },
  bold: { fontWeight: "600" },
  link: { fontSize: 13, color: colors.forest, textDecorationLine: "underline" },
  tableScroll: { marginVertical: 4 },
  table: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  header: { backgroundColor: colors.surface },
  cell: {
    width: 156,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
});
