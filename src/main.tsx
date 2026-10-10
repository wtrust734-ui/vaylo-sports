import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import VayloLoader from "./components/VayloLoader";
import { installGlobalErrorReporting, reportError } from "./lib/errorReporting";
import { initI18n } from "./i18n";
import "./index.css";

// Last-resort guard for rejections outside React's error boundaries — a plugin
// call, a fetch that outlived its component. Recorded once, in the app's own
// words (name + message only: never a stack, never a payload), so a stray
// async failure cannot crash the WebView or leak internals. Render-time
// failures stay with <ErrorBoundary>.
//
// The second half of the job is new: the same failure is sent to the
// report-error edge function, so it reaches a human instead of a logcat buffer
// on a tester's phone. That call never throws and never blocks the first paint —
// see lib/errorReporting.ts for what it does and does not send.
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  const detail =
    reason instanceof Error ? `${reason.name}: ${reason.message}` : typeof reason;
  console.error("Unhandled rejection:", detail);
  reportError({
    source: "rejection",
    name: reason instanceof Error ? reason.name : "UnhandledRejection",
    message: reason instanceof Error ? detail : String(reason),
    stack: reason instanceof Error ? reason.stack ?? null : null,
  });
  event.preventDefault();
});

// Catches the failure mode no other handler covers: an uncaught error thrown
// from an event handler or a Capacitor plugin callback, which in a WebView
// otherwise vanishes without even a toast. Installed before the first render so
// a failure during startup is reported too.
installGlobalErrorReporting();

// Mount only after the persisted/device language is applied, so the very first
// paint is already in the right language AND direction (Arabic must never
// flash LTR English before flipping). If init ever fails, i18n still has the
// synchronous English bundle registered, so we render anyway rather than
// leaving a blank screen.
const root = createRoot(document.getElementById("root")!);
root.render(<VayloLoader message="Preparing your performance space" />);
initI18n()
  .catch((e) => console.warn("i18n init failed — rendering in English", e))
  .finally(() => root.render(<App />));
