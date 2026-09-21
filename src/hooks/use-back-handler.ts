import { useEffect, useRef } from "react";
import { pushBackHandler } from "@/lib/backButton";

/**
 * While `active`, the device back button calls `handler` instead of leaving the
 * screen — used by overlays so back closes them. The latest handler is kept in a
 * ref so an inline arrow function does not re-register on every render.
 */
export function useBackHandler(active: boolean, handler: () => void) {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => latest.current());
  }, [active]);
}
