import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/lifecycle errors anywhere below it.
 *
 * Without this, one broken screen (bad data, a thrown render) takes the whole
 * app to a blank page with no way back — historically the worst failure mode
 * this app has had.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-card">
          <h1 className="font-display text-lg font-bold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This screen hit an unexpected error. Your training data is safe.
          </p>
          <p className="mt-3 break-words rounded-lg bg-muted p-2 text-[11px] text-muted-foreground">
            {error.message || "Unknown error"}
          </p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:border-primary/40 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
