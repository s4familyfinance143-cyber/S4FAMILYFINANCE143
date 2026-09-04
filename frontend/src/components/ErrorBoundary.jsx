import { Component } from "react";

import { captureWebException } from "../lib/sentry.js";

/**
 * Catches React render errors so the UI shows a recovery screen
 * instead of a blank white page.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "", stack: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || "Unexpected error",
      stack: String(error?.stack || ""),
    };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
    try {
      captureWebException(error, { componentStack: info?.componentStack });
    } catch {
      /* Sentry optional */
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, message: "", stack: "" });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const title = this.props.title || "Something went wrong";
    const hint =
      this.props.hint ||
      "The app hit an unexpected error. You can try again or reload the page.";

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "linear-gradient(160deg, #f3f7f6 0%, #e8f0ee 100%)",
          fontFamily: "Segoe UI, system-ui, sans-serif",
        }}
      >
        <div
          role="alert"
          style={{
            textAlign: "center",
            maxWidth: 440,
            width: "100%",
            background: "#fff",
            border: "1px solid #d7e3df",
            borderRadius: 16,
            padding: "28px 24px",
            boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
          }}
        >
          <p style={{ margin: "0 0 8px", color: "#0f766e", fontWeight: 800, letterSpacing: "0.04em", fontSize: 12 }}>
            S4 FAMILY 143
          </p>
          <h1 style={{ margin: "0 0 10px", color: "#0f766e", fontSize: 22 }}>{title}</h1>
          <p style={{ margin: "0 0 12px", color: "#475569", lineHeight: 1.45 }}>{hint}</p>
          <p
            style={{
              margin: "0 0 20px",
              color: "#64748b",
              fontSize: 13,
              wordBreak: "break-word",
              background: "#f8fafc",
              borderRadius: 10,
              padding: "10px 12px",
              textAlign: "left",
            }}
          >
            {this.state.message}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                border: "1px solid #0f766e",
                background: "#0f766e",
                color: "#fff",
                borderRadius: 10,
                padding: "10px 16px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#334155",
                borderRadius: 10,
                padding: "10px 16px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/** Last-resort handlers for errors ErrorBoundary cannot catch (module load, async). */
export function installGlobalErrorHandlers() {
  if (typeof window === "undefined") return;
  if (window.__s4GlobalErrorHandlersInstalled) return;
  window.__s4GlobalErrorHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    console.error("[S4 global error]", event?.error || event?.message || event);
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[S4 unhandledrejection]", event?.reason || event);
  });
}
