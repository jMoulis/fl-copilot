import { useCallback, useRef, useState } from "react";
import { Image, Text } from "react-native";
import { useFocusEffect } from "expo-router";
import type {
  VisualAsset,
  VisualEntityMap,
  VisualEntityType,
} from "@fl-copilot/domain";
import { useLocalDatabase } from "../providers/database-provider";
import { SectionCard, SecondaryButton } from "../components/ui";
import { visualConflictSummary } from "./visual-conflict-presentation";
import { nativeVisualFileStorage } from "./visual-file-storage";
import { VisualFileCache } from "./visual-file-cache";
export function VisualVersion({
  title,
  entity,
  labels,
  preview,
}: {
  title: string;
  entity: VisualEntityMap[VisualEntityType];
  labels: Record<string, string>;
  preview: VisualAsset | null;
}) {
  const { sqlite } = useLocalDatabase();
  const [uri, setUri] = useState<string | null>(),
    [busy, setBusy] = useState(false);
  const live = useRef(0);
  useFocusEffect(
    useCallback(() => {
      live.current++;
      return () => {
        live.current++;
      };
    }, []),
  );
  async function open() {
    if (!preview || busy) return;
    const run = live.current;
    setBusy(true);
    try {
      const cached = await new VisualFileCache(sqlite)
        .get(preview.storeId, preview, "PREVIEW")
        .catch(() => null);
      const thumbnail = cached?.manifest
        ? await nativeVisualFileStorage
            .uri(preview.storeId, "PREVIEW", {
              contentHash: cached.manifest.preview.contentHash,
              mimeType: cached.manifest.preview.mimeType,
              sizeBytes: cached.manifest.preview.sizeBytes,
            })
            .catch(() => null)
        : null;
      const source =
        thumbnail ??
        (await nativeVisualFileStorage
          .uri(preview.storeId, "SOURCE", preview)
          .catch(() => null));
      if (live.current === run) setUri(source);
    } finally {
      if (live.current === run) setBusy(false);
    }
  }
  return (
    <SectionCard title={title}>
      {visualConflictSummary(entity, labels).map((line, i) => (
        <Text key={i} className="text-base text-ink">
          {line}
        </Text>
      ))}
      <Text className="text-sm text-muted">
        Version {entity.version} ·{" "}
        {new Date(entity.updatedAt).toLocaleString("fr-FR")}
      </Text>
      {preview ? (
        <SecondaryButton
          label={busy ? "Lecture…" : "Voir la photo conservée sur cet appareil"}
          disabled={busy}
          onPress={() => void open()}
        />
      ) : null}
      {uri ? (
        <Image
          source={{ uri }}
          resizeMode="contain"
          style={{ width: "100%", height: 180 }}
          accessibilityLabel="Photo conservée pour comparer les versions"
        />
      ) : uri === null ? (
        <Text className="text-sm text-muted">
          La photo n’est pas disponible sur cet appareil. Aucune source n’a été
          supprimée.
        </Text>
      ) : null}
    </SectionCard>
  );
}
