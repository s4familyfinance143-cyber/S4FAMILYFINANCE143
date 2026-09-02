import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { Component, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { create } from "zustand";
import { captureWebException, initWebSentry } from "./lib/sentry.js";

initWebSentry();

if (Capacitor.isNativePlatform()) {
  import("@capacitor/status-bar")
    .then(({ StatusBar, Style }) => {
      StatusBar.setStyle({ style: Style.Light }).catch(() => {});
      StatusBar.setBackgroundColor({ color: "#ffffff" }).catch(() => {});
    })
    .catch(() => {});
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: false },
  },
});

export const usePcAppStore = create((set) => ({
  theme: "light",
  setTheme: (theme) => set({ theme }),
}));

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Unexpected error" };
  }

  componentDidCatch(error, info) {
    console.error("AppErrorBoundary", error, info);
    captureWebException(error, { componentStack: info?.componentStack });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f3f7f6" }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <h1 style={{ color: "#0f766e" }}>Something went wrong</h1>
          <p style={{ color: "#475569" }}>{this.state.message}</p>
          <button type="button" onClick={() => this.setState({ hasError: false, message: "" })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>
);

if (import.meta.env.PROD && !Capacitor.isNativePlatform()) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({ immediate: true });
    })
    .catch(() => {
      /* SW optional */
    });
}
