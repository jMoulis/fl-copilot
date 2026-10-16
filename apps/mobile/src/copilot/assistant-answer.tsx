import { useMemo, useState, type ReactNode } from "react";
import {
  ScrollView,
  Text,
  View,
  StyleSheet,
  Linking,
  Pressable,
} from "react-native";
import {
  copilotExternalResearchSourceSchema,
  isPublicResearchUrl,
} from "@fl-copilot/domain";
import type { z } from "zod";
import { BottomSheet } from "../components/ui";
import { colors } from "../design/tokens";
import { markdownBlocks } from "./markdown-blocks";
type Source = {
  label: string;
  value: string | number | null;
  sourceId: string;
  externalResearch?: z.infer<typeof copilotExternalResearchSourceSchema>;
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
  const [linkError, setLinkError] = useState(false);
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
      ) {
        if (
          v.externalResearch &&
          !copilotExternalResearchSourceSchema.safeParse(v.externalResearch)
            .success
        )
          return;
        setLinkError(false);
        setSource(v);
      }
    } catch {
      /* Partial citations become clickable only after their token closes. */
    }
  }
  function inline(value: string): ReactNode[] {
    const parts = value.split(
      /(\*\*[^*]+\*\*|\[[^\]]+\]\(copilot-source:[^)]+\))/g,
    );
    return parts.map((part, i) => {
      const link = parts[i - 1]?.endsWith("\\")
        ? null
        : /^\[([^\]]+)\]\(copilot-source:([^)]+)\)$/.exec(part);
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
            {source.externalResearch ? (
              <View style={styles.answer}>
                <Text style={styles.text}>
                  Recherche web · consultée le{" "}
                  {new Date(
                    source.externalResearch.accessedAt,
                  ).toLocaleDateString("fr-FR")}
                </Text>
                {source.externalResearch.citations.map((citation) => (
                  <Pressable
                    key={citation.url}
                    accessibilityRole="link"
                    accessibilityLabel={`Ouvrir la source : ${citation.title}`}
                    style={styles.externalLink}
                    onPress={() => {
                      setLinkError(false);
                      if (!isPublicResearchUrl(citation.url)) {
                        setLinkError(true);
                        return;
                      }
                      void Linking.openURL(citation.url).catch(() =>
                        setLinkError(true),
                      );
                    }}
                  >
                    <Text style={styles.text}>{citation.title}</Text>
                    <Text style={styles.link}>
                      {new URL(citation.url).hostname}
                    </Text>
                  </Pressable>
                ))}
                {linkError ? (
                  <Text accessibilityRole="alert" style={styles.text}>
                    Impossible d’ouvrir ce lien. Réessayez avec une connexion
                    disponible.
                  </Text>
                ) : null}
              </View>
            ) : (
              renderSource?.(source.sourceId)
            )}
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}
const styles = StyleSheet.create({
  answer: { gap: 14 },
  externalLink: { minHeight: 44, paddingVertical: 10, gap: 4 },
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
