import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/errorReporting";
import { isNativeShell } from "@/lib/platform";

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
    // Render errors are reported from where they are caught, with their own
    // source — never rethrown, so a render error cannot become a rejection
    // too. reportError never throws, so this cannot break the boundary.
    reportError({
      source: "react",
      name: error.name || "Error",
      message: error.message || "Unknown error",
      stack: error.stack ?? info.componentStack ?? null,
    });
  }

  private reset = () => this.setState({ error: null });

  /**
   * Leave the screen that failed, rather than reloading the whole app.
   *
   * A render error is usually local to one tab (a bad row, a chart library).
   * `window.location.reload()` used to re-mount the same broken tab and throw
   * the athlete straight back here — the button looked like an escape and was
   * actually a loop. Going home is a real exit: the app re-mounts at a screen
   * that works, with the session intact. HashRouter needs the `/#/` form in
   * the native shell; BrowserRouter serves `/` on the web.
   */
  private exitTab = () => {
    const home = isNativeShell() ? "/#/" : "/";
    window.location.assign(home);
  };

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
          <p className="mt-3 break-words rounded-lg bg-muted p-2 text-[12px] text-muted-foreground">
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
              onClick={this.exitTab}
              className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:border-primary/40 transition-colors"
            >
              Exit the tab
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
