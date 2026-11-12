import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import type { DatedKpiValue, ExplorerPeriod } from "@fl-copilot/analytics-core";
import { colors } from "../design/tokens";
import { productSparkline } from "./product-sparkline";

export const ProductSparkline = memo(function ProductSparkline({
  period,
  points,
}: {
  period: ExplorerPeriod;
  points: readonly DatedKpiValue[];
}) {
  const plot = useMemo(
    () => productSparkline(period, points),
    [period, points],
  );
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: 66, gap: 3, alignItems: "center" }}
    >
      <View style={{ width: 66, height: 30 }}>
        {plot.segments.map((segment, index) => (
          <View
            key={index}
            style={{
              position: "absolute",
              left: segment.x,
              top: segment.y - 1,
              width: segment.length,
              height: 2,
              borderRadius: 1,
              backgroundColor: colors.forest,
              opacity: segment.complete ? 0.9 : 0.45,
              transformOrigin: "left center",
              transform: [{ rotate: `${segment.angle}rad` }],
            }}
          />
        ))}
        {plot.isolated.map((dot, index) => (
          <View
            key={`dot:${index}`}
            style={{
              position: "absolute",
              left: dot.x - 2,
              top: dot.y - 2,
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.forest,
              opacity: dot.complete ? 0.9 : 0.45,
            }}
          />
        ))}
        {!plot.available ? (
          <View
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              top: 15,
              height: 1,
              backgroundColor: colors.line,
            }}
          />
        ) : null}
      </View>
      {plot.expected === 1 || !plot.available ? (
        <Text style={{ fontSize: 9, color: colors.muted, letterSpacing: 0.2 }}>
          {plot.expected === 1 ? "Jour" : "Sans données"}
        </Text>
      ) : null}
    </View>
  );
});
