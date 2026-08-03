import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      const isEnvError = this.state.error.message.includes("Supabase environment variables");
      const message = isEnvError
        ? "Configuration error: Missing environment variables. Please check your .env file."
        : this.state.error.message;

      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "2rem",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}>
          <div style={{
            fontSize: "3rem",
            marginBottom: "1rem",
          }}>⚠️</div>
          <h1 style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            marginBottom: "0.5rem",
            color: "#1a1a2e",
          }}>Something went wrong</h1>
          <p style={{
            fontSize: "0.875rem",
            color: "#6b7280",
            maxWidth: "28rem",
            marginBottom: "1.5rem",
            lineHeight: 1.6,
          }}>{message}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "0.625rem 1.5rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#6d5efc",
              color: "white",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >Reload page</button>
        </div>
      );
    }

    return this.props.children;
  }
}
