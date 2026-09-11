import React, { useEffect, useState } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";

type Props = {
  brandTitle?: string;
  hint?: string;
  onDone?: () => void;
};

/**
 * Mobile splash — same readable mix as PC:
 * teal/sky atmosphere + light frosted card, dark title, clear % badge.
 */
export function MobileSplashScreen({
  brandTitle = "S4 FAMILY FINANCE 143",
  hint = "Loading…",
  onDone,
}: Props) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let value = 0;
    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled) return;
      value += 1;
      setProgress(value);
      if (value >= 100) {
        clearInterval(timer);
        setTimeout(() => {
          if (!cancelled) onDone?.();
        }, 120);
      }
    }, 20);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [onDone]);

  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }}>
      <StatusBar barStyle="light-content" />
      <View style={styles.glowMint} />
      <View style={styles.glowSky} />
      <View style={styles.glowGold} />

      <View style={styles.frame}>
        <View style={styles.frameWashTop} />
        <View style={styles.frameWashBottom} />
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>S4 Family</Text>
          <Text style={styles.title}>{brandTitle}</Text>
          <Text style={styles.hint}>{hint}</Text>
        </View>
        <View style={styles.progressWrap}>
          <View style={styles.track}>
            <View style={[styles.chunk, { width: `${Math.max(progress, 2)}%` }]}>
              <View style={styles.chunkMint} />
              <View style={styles.chunkSky} />
            </View>
          </View>
          <View style={styles.percentBadge}>
            <Text style={styles.percent}>{progress}%</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#0b1f2a",
  },
  glowMint: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 220,
    bottom: 40,
    alignSelf: "center",
    backgroundColor: "rgba(32, 201, 151, 0.22)",
  },
  glowSky: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 180,
    top: 48,
    left: 12,
    backgroundColor: "rgba(61, 156, 240, 0.18)",
  },
  glowGold: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 160,
    top: 64,
    right: 8,
    backgroundColor: "rgba(232, 184, 109, 0.16)",
  },
  frame: {
    position: "relative",
    width: "100%",
    maxWidth: 600,
    height: 400,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.7)",
    backgroundColor: "#e8f7f2",
    justifyContent: "flex-end",
  },
  frameWashTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "55%",
    backgroundColor: "rgba(255, 255, 255, 0.72)",
  },
  frameWashBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "50%",
    backgroundColor: "rgba(214, 236, 246, 0.7)",
  },
  copy: {
    position: "absolute",
    left: 20,
    right: 20,
    top: "18%",
    zIndex: 2,
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(15, 143, 111, 0.16)",
  },
  eyebrow: {
    marginBottom: 8,
    color: "#0f8f6f",
    letterSpacing: 2,
    textTransform: "uppercase",
    fontSize: 12,
    fontWeight: "800",
  },
  title: {
    color: "#0b3d32",
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 32,
    textAlign: "center",
  },
  hint: {
    marginTop: 12,
    color: "#3d5a52",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  progressWrap: {
    zIndex: 2,
    marginHorizontal: 20,
    marginBottom: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(15, 143, 111, 0.18)",
  },
  track: {
    flex: 1,
    height: 16,
    borderWidth: 1,
    borderColor: "rgba(15, 143, 111, 0.22)",
    borderRadius: 999,
    backgroundColor: "#e6f2ee",
    overflow: "hidden",
  },
  chunk: {
    height: "100%",
    borderRadius: 999,
    minWidth: 8,
    flexDirection: "row",
    overflow: "hidden",
    backgroundColor: "#0f8f6f",
  },
  chunkMint: {
    flex: 1,
    backgroundColor: "#20c997",
  },
  chunkSky: {
    width: "34%",
    backgroundColor: "#3d9cf0",
  },
  percentBadge: {
    minWidth: 52,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#dff7ef",
    borderWidth: 1,
    borderColor: "rgba(15, 143, 111, 0.2)",
    alignItems: "center",
  },
  percent: {
    color: "#0b3d32",
    fontSize: 13,
    fontWeight: "900",
  },
});
