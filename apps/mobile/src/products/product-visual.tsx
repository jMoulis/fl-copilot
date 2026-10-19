import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type {
  ProductVisualResolution,
  VisualAsset,
  Product,
} from "@fl-copilot/domain";
import { colors } from "../design/tokens";
export interface ProductVisualProps {
  resolution?: ProductVisualResolution;
  category: Product["category"];
  candidate?: { asset: VisualAsset; illustrative: boolean; generic: boolean };
  size?: number;
  readUri?: (asset: VisualAsset) => Promise<string | null>;
  onAvailability?(available: boolean): void;
}
/** Cached pixels or a neutral placeholder; rendering never waits on a remote request. */
export function ProductVisual({
  resolution,
  candidate,
  category,
  size = 60,
  readUri,
  onAvailability,
}: ProductVisualProps) {
  const visual = resolution?.kind === "ASSET" ? resolution : candidate;
  const asset =
    visual?.asset.review.status === "APPROVED" && !visual.asset.deletedAt
      ? visual.asset
      : undefined;
  const [image, setImage] = useState<{ key: string; uri: string } | null>(null);
  const key = asset
    ? `${asset.storeId}:${asset.id}:${asset.version}`
    : "placeholder";
  useEffect(() => {
    let live = true;
    onAvailability?.(false);
    if (asset && readUri)
      void readUri(asset)
        .then((uri) => {
          if (live) {
            setImage(uri ? { key, uri } : null);
            onAvailability?.(!!uri);
          }
        })
        .catch(() => {
          if (live) {
            setImage(null);
            onAvailability?.(false);
          }
        });
    return () => {
      live = false;
    };
  }, [asset, key, readUri, onAvailability]);
  const uri = image?.key === key ? image.uri : null;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 16,
        backgroundColor: colors.surfaceMuted,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          accessibilityLabel={
            visual?.illustrative
              ? "Illustration de synthèse"
              : visual?.generic
                ? "Visuel générique du produit"
                : "Photo du produit"
          }
          resizeMode="contain"
          resizeMethod="resize"
          style={{ width: "100%", height: "100%" }}
          onError={() => {
            setImage(null);
            onAvailability?.(false);
          }}
        />
      ) : (
        <Ionicons
          name={category === "FRUIT" ? "nutrition-outline" : "leaf-outline"}
          size={Math.min(46, size / 2)}
          color={colors.muted}
          accessibilityLabel="Aucun visuel disponible sur cet appareil"
        />
      )}
      {visual?.illustrative ? (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: colors.overlay,
            padding: 3,
          }}
        >
          <Text
            style={{ fontSize: 10, color: colors.ink, textAlign: "center" }}
          >
            Illustration
          </Text>
        </View>
      ) : null}
    </View>
  );
}
