import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { explorerHref } from "../analytics/explorer-link";
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
  type AnalyticsDestinationTable,
  retailExpertiseFreshness,
  isPublicResearchUrl,
} from "@fl-copilot/domain";
import {
  readAnswerSource,
  formatSourcePublication,
  type AnswerSource,
} from "./answer-source";
import { BottomSheet, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
import { markdownBlocks } from "./markdown-blocks";
/** Small native Markdown surface: no HTML, arbitrary URL navigation or webview. */
export function AssistantAnswer({
  text,
  renderSource,
  selectable = true,
  analyticsDestinations,
}: {
  text: string;
  selectable?: boolean;
  analyticsDestinations?: AnalyticsDestinationTable;
  renderSource?(id: string): ReactNode;
}) {
  const [source, setSource] = useState<AnswerSource>();
  const [linkError, setLinkError] = useState(false);
  const blocks = useMemo(() => markdownBlocks(text), [text]);
  function openSource(encoded: string) {
    try {
      const value = readAnswerSource(encoded, analyticsDestinations);
      setLinkError(false);
      setSource(value);
    } catch {
      /* Partial citations become clickable only after their token closes. */
    }
  }
  const citations =
    source?.retailExpertise?.sources ??
    source?.externalResearch?.citations.map((citation) => ({
      ...citation,
      publishedOn: null,
      publisher: undefined,
    })) ??
    [];
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
                      selectable={selectable}
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
            selectable={selectable}
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
            <Text selectable={selectable} style={[styles.text, styles.bold]}>
              {source.label}
            </Text>
            <Text selectable={selectable} style={styles.text}>
              {source.value === null
                ? "Valeur non disponible"
                : String(source.value)}
            </Text>
            {source.analyticsContext ? (
              <View style={styles.answer}>
                <Text style={styles.text}>
                  Consultez les données locales actuelles de cette sélection. La
                  valeur citée ci-dessus reste celle de cette discussion.
                  {source.analyticsContext.relation === "RELATED_AMOUNTS"
                    ? " Le détail affiche les montants en euros qui servent au taux, pas le taux lui-même."
                    : ""}
                </Text>
                <SecondaryButton
                  label={
                    source.analyticsContext.relation === "RELATED_AMOUNTS"
                      ? "Voir les montants de cette période"
                      : "Explorer ces chiffres"
                  }
                  onPress={() => {
                    try {
                      const href = explorerHref({
                        requestId: randomUUID(),
                        period: source.analyticsContext!.period,
                        metric: source.analyticsContext!.metric,
                        filters: source.analyticsContext!.filters,
                      });
                      router.navigate(href);
                      setSource(undefined);
                    } catch {
                      setLinkError(true);
                    }
                  }}
                />
                {linkError ? (
                  <Text accessibilityRole="alert" style={styles.text}>
                    Cette sélection ne peut pas être ouverte. La source reste
                    consultable ici.
                  </Text>
                ) : null}
              </View>
            ) : null}
            {source.externalResearch || source.retailExpertise ? (
              <View style={styles.answer}>
                <Text style={styles.text}>
                  {source.retailExpertise
                    ? `Référentiel métier · version ${source.retailExpertise.version} · relu le ${new Date(source.retailExpertise.reviewedOn + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC" })}`
                    : `Recherche web · consultée le ${new Date(source.externalResearch!.accessedAt).toLocaleDateString("fr-FR")}`}
                </Text>
                {source.retailExpertise ? (
                  <Text style={styles.text}>
                    {retailExpertiseFreshness(
                      source.retailExpertise,
                      new Date().toISOString(),
                    ) === "CURRENT"
                      ? "Prochaine revue prévue avant le "
                      : "Repère à revalider · date de revue : "}
                    {new Date(
                      source.retailExpertise.reviewAfterOn + "T12:00:00Z",
                    ).toLocaleDateString("fr-FR", { timeZone: "UTC" })}
                  </Text>
                ) : null}
                {citations.map((citation) => (
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
                    {citation.publisher ? (
                      <Text style={styles.text}>
                        {citation.publisher}
                        {` · ${formatSourcePublication(citation.publishedOn)}`}
                      </Text>
                    ) : null}
                    {"scope" in citation ? (
                      <Text style={styles.text}>{String(citation.scope)}</Text>
                    ) : null}
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
