import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { ErrorBoundary, installGlobalErrorHandlers } from "./components/ErrorBoundary.jsx";
import { create } from "zustand";
import { initWebSentry } from "./lib/sentry.js";

installGlobalErrorHandlers();
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

const rootEl = document.getElementById("root");

if (!rootEl) {
  document.body.innerHTML =
    '<main style="min-height:100vh;display:grid;place-items:center;font-family:sans-serif;padding:24px"><p>Root element #root was not found.</p></main>';
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary title="App failed to render" hint="A screen crashed. Try again — your data is safe in local/cloud storage.">
            <App />
          </ErrorBoundary>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>
  );
}

if (import.meta.env.PROD && !Capacitor.isNativePlatform()) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({ immediate: true });
    })
    .catch(() => {
      /* SW optional */
    });
}
