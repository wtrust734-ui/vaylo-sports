import { useEffect, useRef, useState } from "react";
import { clearAiIntent, readAiIntent, writeAiIntent, type AiIntent } from "@/lib/aiIntent";

/** Synchronous durable writes happen before network work; storage errors remain visible. */
export function useAiIntent<Q, R, C>(userId: string | undefined, operation: string) {
  type Intent = AiIntent<Q, R, C>;
  const owner = `${userId ?? ""}:${operation}`;
  const current = useRef({ owner, epoch: 0 });
  if (current.current.owner !== owner) current.current = { owner, epoch: current.current.epoch + 1 };
  const epoch = current.current.epoch;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [state, setState] = useState<{ owner: string; intent: Intent | null; error?: string }>({ owner, intent: null });
  useEffect(() => {
    try {
      setState({ owner, intent: userId ? readAiIntent<Q, R, C>(userId, operation) : null });
    } catch {
      setState({ owner, intent: null, error: "Saved requests are unavailable. Enable browser storage before continuing." });
    }
  }, [owner, userId, operation]);
  const isCurrent = () => mounted.current && current.current.owner === owner && current.current.epoch === epoch;
  const get = () => userId ? readAiIntent<Q, R, C>(userId, operation) : null;
  const save = (intent: Intent) => {
    if (!userId || !isCurrent()) throw new Error("Account or plan changed. Return to the original account and plan to resume.");
    writeAiIntent(userId, operation, intent);
    setState({ owner, intent });
    return intent;
  };
  const begin = (create: () => Intent) => {
    const previous = get();
    return previous ?? save(create());
  };
  const complete = (id: string) => {
    if (!userId || !isCurrent()) return;
    clearAiIntent(userId, operation, id);
    setState({ owner, intent: get() });
  };
  const run = async (work: () => Promise<void>) => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request(`vaylo-ai:${owner}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("This request is already running in another tab. Resume it here after that tab finishes.");
        if (isCurrent()) await work();
      });
    } else {
      // Capacitor WebViews without Web Locks still use the screen's synchronous in-flight guard.
      await work();
    }
  };
  return { run, pending: state.owner === owner ? state.intent : null, error: state.owner === owner ? state.error : undefined, begin, save, complete, get, isCurrent };
}
