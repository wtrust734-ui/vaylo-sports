import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import BootVeil from "./components/BootVeil";
import { initI18n } from "./i18n";
import "./index.css";
import { installGlobalErrorReporting, reportError } from "@/lib/errorReporting";
import { isNativeShell } from "@/lib/platform";

// Native-shell + touch flags, set synchronously before first paint so CSS can
// target the app shell (`[data-native="true"]`) without a flash of web
// styling. matchMedia only — no plugin calls, so this never blocks startup.
try {
  if (isNativeShell()) document.documentElement.dataset.native = "true";
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  ) {
    document.documentElement.dataset.touch = "true";
  }
} catch {
  // Flags are progressive enhancement; a failure leaves the web styling.
}

// Uncaught event-handler/plugin errors had no handler at all and vanished in
// the WebView without even a toast. Installed once here, at startup, so every
// launch is covered — and it never throws, so a broken reporter cannot break
// the app it is meant to watch.
installGlobalErrorReporting();

// Last-resort guard for rejections outside React's error boundaries — a plugin
// call, a fetch that outlived its component. Recorded once, in the app's own
// words (name + message only: never a stack, never a payload), so a stray
// async failure cannot crash the WebView or leak internals. Render-time
// failures stay with <ErrorBoundary>. reportError is fire-and-forget and never
// throws, so reporting the rejection cannot turn it into a second failure.
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  const detail =
    reason instanceof Error ? `${reason.name}: ${reason.message}` : typeof reason;
  console.error("Unhandled rejection:", detail);
  reportError({
    source: "rejection",
    name: reason instanceof Error ? reason.name : "UnhandledRejection",
    message: reason instanceof Error ? reason.message : String(detail),
    stack: reason instanceof Error ? (reason.stack ?? null) : null,
  });
  event.preventDefault();
});

// Mount only after the persisted/device language is applied, so the very first
// paint is already in the right language AND direction (Arabic must never
// flash LTR English before flipping). If init ever fails, i18n still has the
// synchronous English bundle registered, so we render anyway rather than
// leaving a blank screen.
//
// What paints first is the BootVeil — the same surface App mounts, on the same
// module-level clock — not a second, differently-dressed loader. The old
// sequence (loader → cut → veil → cut → app) is why opening felt abrupt; now
// there is one brand surface from the first frame until the app is actually
// ready underneath it.
const root = createRoot(document.getElementById("root")!);
root.render(<BootVeil />);
initI18n()
  .catch((e) => console.warn("i18n init failed — rendering in English", e))
  .finally(() => root.render(<App />));
