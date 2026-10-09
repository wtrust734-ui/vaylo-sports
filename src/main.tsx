import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import VayloLoader from "./components/VayloLoader";
import { initI18n } from "./i18n";
import "./index.css";

// Last-resort guard for rejections outside React's error boundaries — a plugin
// call, a fetch that outlived its component. Recorded once, in the app's own
// words (name + message only: never a stack, never a payload), so a stray
// async failure cannot crash the WebView or leak internals. Render-time
// failures stay with <ErrorBoundary>.
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  const detail =
    reason instanceof Error ? `${reason.name}: ${reason.message}` : typeof reason;
  console.error("Unhandled rejection:", detail);
  event.preventDefault();
});

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
