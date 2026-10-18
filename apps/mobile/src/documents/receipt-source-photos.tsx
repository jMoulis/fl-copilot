import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { useLocalDatabase } from "../providers/database-provider";
import { readReceiptPhotoViews } from "./receipt-photo-views";
/** Source display always reads the local source/receipt/file linkage first. */
export function ReceiptSourcePhotos({
  storeId,
  sourceDocumentId,
  fallbackUri,
}: {
  storeId: string;
  sourceDocumentId?: string | null;
  fallbackUri: string | null;
}) {
  const { sqlite } = useLocalDatabase();
  const scope = `${storeId}/${sourceDocumentId ?? ""}/${fallbackUri ?? ""}`;
  const [state, setState] = useState<{
    scope: string;
    photos: Array<string | null>;
  }>({ scope, photos: [] });
  useEffect(() => {
    let active = true;
    const read = sourceDocumentId
      ? readReceiptPhotoViews(sqlite, storeId, sourceDocumentId)
      : Promise.resolve(null);
    void read
      .then(async (result) => {
        const uris = result?.grouped
          ? result.views.map((view) => view.localUri)
          : result && fallbackUri
            ? [fallbackUri]
            : [];
        const { File, Directory, Paths } = await import("expo-file-system");
        const photos = uris.map((uri) => {
          const original = new File(uri);
          if (original.exists) return original.uri;
          const name = uri.split("/").at(-1);
          const moved = name
            ? new File(new Directory(Paths.document, "waste-receipts"), name)
            : null;
          return moved?.exists ? moved.uri : null;
        });
        if (active) setState({ scope, photos });
      })
      .catch(() => {
        if (active) setState({ scope, photos: [] });
      });
    return () => {
      active = false;
    };
  }, [sqlite, storeId, sourceDocumentId, fallbackUri, scope]);
  const photos = state.scope === scope ? state.photos : [];
  return (
    <View className="gap-3">
      {photos.length ? (
        photos.map((uri, index) => (
          <View key={index}>
            {photos.length > 1 ? (
              <Text className="text-sm text-muted">
                Vue {index + 1} sur {photos.length}
              </Text>
            ) : null}
            {uri ? (
              <Image
                source={{ uri }}
                resizeMode="contain"
                className="h-80 w-full rounded-2xl bg-surface-muted"
                accessibilityLabel={`Photo source du ticket, vue ${index + 1}`}
              />
            ) : (
              <Text className="text-sm text-muted">
                Cette vue n’est pas disponible sur cet appareil.
              </Text>
            )}
          </View>
        ))
      ) : (
        <Text className="text-sm text-muted">
          Photos sources indisponibles sur cet appareil.
        </Text>
      )}
    </View>
  );
}
