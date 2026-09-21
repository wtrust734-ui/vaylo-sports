// ============================================================================
// TOASTS — ONE SYSTEM
// ----------------------------------------------------------------------------
// The app used to render toasts twice: sonner *and* the shadcn reducer with its
// own <Toaster/>. They stacked in different corners with different styles, and
// calls were split roughly half and half between them.
//
// The renderer is now sonner only. This module keeps the old call shape
// (`const { toast } = useToast(); toast({ title, description, variant })`)
// working — it simply forwards to sonner — so the 26 files that use it did not
// need touching. New code can import `toast` from "sonner" directly.
// ============================================================================

import type { ReactNode } from "react";
import { toast as sonnerToast, type ExternalToast } from "sonner";

export interface ToastOptions {
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive" | null;
  duration?: number;
  /** Raw sonner options passed through when provided. */
  action?: ExternalToast["action"];
  cancel?: ExternalToast["cancel"];
  id?: string | number;
}

export type ToastProps = ToastOptions;
export type ToastActionElement = ReactNode;
/** Kept for compatibility with the previous implementation's exported types. */
export type ToasterToast = ToastOptions & { id: string; open?: boolean };

const toSonnerOptions = (options: ToastOptions): ExternalToast => ({
  description: options.description,
  duration: options.duration,
  action: options.action,
  cancel: options.cancel,
  id: options.id,
});

/**
 * Shows a toast. Accepts either a plain message or the shadcn-style object so
 * both call styles keep working.
 */
export function toast(options: ToastOptions | string): { id: string | number; dismiss: () => void } {
  if (typeof options === "string") {
    const id = sonnerToast(options);
    return { id, dismiss: () => sonnerToast.dismiss(id) };
  }

  const { title, variant } = options;
  const id =
    variant === "destructive"
      ? sonnerToast.error(title ?? "Something went wrong", toSonnerOptions(options))
      : sonnerToast(title ?? "", toSonnerOptions(options));

  return { id, dismiss: () => sonnerToast.dismiss(id) };
}

export const dismiss = (id?: string | number) => sonnerToast.dismiss(id);

export function useToast() {
  return {
    toast,
    dismiss,
    // The old hook exposed the queue; nothing in the app renders it any more,
    // but keeping the key (typed to the old shape) avoids breaking destructuring.
    toasts: [] as ToasterToast[],
  };
}
