import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initI18n } from "./i18n";
import "./index.css";

// Mount only after the persisted/device language is applied, so the very first
// paint is already in the right language AND direction (Arabic must never
// flash LTR English before flipping). If init ever fails, i18n still has the
// synchronous English bundle registered, so we render anyway rather than
// leaving a blank screen.
const root = createRoot(document.getElementById("root")!);
initI18n()
  .catch((e) => console.warn("i18n init failed — rendering in English", e))
  .finally(() => root.render(<App />));
