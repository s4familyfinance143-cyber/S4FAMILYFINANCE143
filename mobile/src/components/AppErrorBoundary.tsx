import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { captureException } from "../lib/sentry";

type Props = {
  children: ReactNode;
  onReset?: () => void;
};

type State = {
  hasError: boolean;
  message: string;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || "Unexpected error" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("AppErrorBoundary", error, info?.componentStack);
    captureException(error, { componentStack: info?.componentStack });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>{this.state.message}</Text>
        <Pressable
          style={styles.btn}
          onPress={() => {
            this.setState({ hasError: false, message: "" });
            this.props.onReset?.();
          }}
        >
          <Text style={styles.btnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#f3f7f6" },
  title: { fontSize: 20, fontWeight: "700", color: "#0f766e", marginBottom: 8 },
  body: { color: "#475569", textAlign: "center", marginBottom: 16 },
  btn: { backgroundColor: "#0d9488", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  btnText: { color: "#fff", fontWeight: "700" },
});
