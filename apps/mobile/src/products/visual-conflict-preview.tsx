import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
  onPreviewReady,
  compact = false,
}: {
  title: string;
  entity: VisualEntityMap[VisualEntityType];
  labels: Record<string, string>;
  preview: VisualAsset | null;
  onPreviewReady?: (ready: boolean) => void;
  compact?: boolean;
}) {
  const { sqlite } = useLocalDatabase();
  const [uri, setUri] = useState<string | null>(),
    [busy, setBusy] = useState(false);
  const source = preview ? JSON.stringify(preview) : null;
  const context = useRef<
    | {
        database: typeof sqlite;
        source: string | null;
        reading: boolean;
      }
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    context.current = undefined;
    setUri(undefined);
    setBusy(false);
    return () => {
      context.current = undefined;
    };
  }, [sqlite, source]);
  useFocusEffect(
    useCallback(() => {
      const current = { database: sqlite, source, reading: false };
      context.current = current;
      setUri(undefined);
      setBusy(false);
      return () => {
        if (context.current === current) context.current = undefined;
      };
    }, [sqlite, source]),
  );
  async function open() {
    const run = context.current;
    if (
      !preview ||
      !run ||
      run.database !== sqlite ||
      run.source !== source ||
      run.reading
    )
      return;
    run.reading = true;
    setBusy(true);
    try {
      const cached = await new VisualFileCache(sqlite)
        .get(preview.storeId, preview, "PREVIEW")
        .catch(() => null);
      if (context.current !== run) return;
      const thumbnail = cached?.manifest
        ? await nativeVisualFileStorage
            .uri(preview.storeId, "PREVIEW", {
              contentHash: cached.manifest.preview.contentHash,
              mimeType: cached.manifest.preview.mimeType,
              sizeBytes: cached.manifest.preview.sizeBytes,
            })
            .catch(() => null)
        : null;
      if (context.current !== run) return;
      const source =
        thumbnail ??
        (await nativeVisualFileStorage
          .uri(preview.storeId, "SOURCE", preview)
          .catch(() => null));
      if (context.current === run) setUri(source);
    } finally {
      if (context.current === run) {
        run.reading = false;
        setBusy(false);
      }
    }
  }
  const displayedContext = context.current;
  return (
    <SectionCard title={title}>
      {(compact
        ? visualConflictSummary(entity, labels).slice(0, 2)
        : visualConflictSummary(entity, labels)
      ).map((line, i) => (
        <Text key={i} className="text-base text-ink">
          {line}
        </Text>
      ))}
      {!compact ? (
        <Text className="text-sm text-muted">
          Version {entity.version} ·{" "}
          {new Date(entity.updatedAt).toLocaleString("fr-FR")}
        </Text>
      ) : null}
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
          onError={() => {
            if (
              displayedContext &&
              context.current === displayedContext &&
              displayedContext.source === source
            ) {
              setUri(null);
              onPreviewReady?.(false);
            }
          }}
          onLoad={() => {
            if (
              displayedContext &&
              context.current === displayedContext &&
              displayedContext.source === source
            )
              onPreviewReady?.(true);
          }}
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
