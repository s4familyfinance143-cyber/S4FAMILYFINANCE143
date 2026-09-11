import React, { Component, type ErrorInfo, type ReactNode, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import Svg, { Rect } from "react-native-svg";
import Constants from "expo-constants";
import { colors } from "../../theme/colors";

export type ChartDatum = { label: string; value: number };

type Props = {
  data: ChartDatum[];
  height?: number;
  title?: string;
};

function SvgBarChart({ data, height = 160, title }: Props) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = Math.max(12, Math.floor(280 / Math.max(data.length, 1)) - 8);
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Svg width="100%" height={height} viewBox={`0 0 300 ${height}`}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 40);
          const x = 20 + i * (barW + 8);
          const y = height - 20 - h;
          return <Rect key={d.label + i} x={x} y={y} width={barW} height={h} rx={4} fill={colors.primary} />;
        })}
      </Svg>
      <View style={styles.labels}>
        {data.map((d) => (
          <Text key={d.label} style={styles.label} numberOfLines={1}>
            {d.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function VictoryBarChart({ data, height = 160, title }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CartesianChart, Bar } = require("victory-native") as {
    CartesianChart: React.ComponentType<any>;
    Bar: React.ComponentType<any>;
  };
  const chartData = useMemo(
    () => data.map((d, i) => ({ x: i + 1, y: Math.max(0, Number(d.value) || 0), label: d.label })),
    [data]
  );
  return (
    <View style={[styles.wrap, { minHeight: height + 40 }]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={{ height }}>
        <CartesianChart data={chartData} xKey="x" yKeys={["y"]}>
          {({ points, chartBounds }: any) => (
            <Bar points={points.y} chartBounds={chartBounds} color={colors.primary} roundedCorners={{ topLeft: 4, topRight: 4 }} />
          )}
        </CartesianChart>
      </View>
      <View style={styles.labels}>
        {data.map((d) => (
          <Text key={d.label} style={styles.label} numberOfLines={1}>
            {d.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

class ChartErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(_e: Error, _i: ErrorInfo) {}
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

/** Victory Native on native builds; SVG fallback in Expo Go / on Victory failure. */
export function Chart(props: Props) {
  const expoGo = Constants.appOwnership === "expo";
  const svg = <SvgBarChart {...props} />;
  if (expoGo) return svg;
  return (
    <ChartErrorBoundary fallback={svg}>
      <VictoryBarChart {...props} />
    </ChartErrorBoundary>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", marginVertical: 8 },
  title: { fontWeight: "700", marginBottom: 6, color: colors.text },
  labels: { flexDirection: "row", justifyContent: "space-around" },
  label: { fontSize: 10, color: colors.textSecondary, flex: 1, textAlign: "center" },
});
