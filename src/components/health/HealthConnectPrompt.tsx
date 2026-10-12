import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Unlink,
} from "lucide-react";

import BottomSheet from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { useHealthConnect } from "@/hooks/useHealthConnect";
import { HEALTH_PERMISSION_LIST } from "@/lib/health/permissions";
import { isAndroid } from "@/lib/platform";
import { isFlagOn } from "@/config/featureFlags";

// ============================================================================
// The "connect your watch" pop-up
// ----------------------------------------------------------------------------
// One sheet, four entry points (sign-up, onboarding, Profile, and the Wearables
// screen's own state), because the reasons to open it are the things an athlete
// actually needs:
//
//   * connect, for the first time, without having to find the Wearables screen
//     at all — the request that produced this file;
//   * manage, once connected: sync now, fix a revoked permission, or stop the
//     app reading anything.
//
// It is the same `useHealthConnect()` hook the Wearables screen uses, so there
// is exactly one implementation of consent, sync and disconnect — this is a
// second door onto that state, not a second copy of it.
//
// Android-only and flag-gated. The bridge does not exist on the web, so
// offering to connect there would be a button that can only fail; callers hide
// the entry point too, and this is the belt to that braces.
// ============================================================================

/** The exact call to action. Asserted by src/lib/healthConnectEntry.test.ts —
 *  the request was for a button that says this. */
export const HEALTH_CONNECT_CTA = "Connect my Health Connect";

/** What the sign-up preview's footer says. It is deliberately not the connect
 *  CTA: nothing can be connected before the account exists, and the button that
 *  says so is the honest one. */
export const HEALTH_CONNECT_ARM_CTA = "Connect it after sign-up";

export interface HealthConnectPromptProps {
  open: boolean;
  onClose: () => void;
  /**
   * Present only on the sign-up screen, where there is deliberately no session
   * yet (a signed-in visitor is redirected away above it) and
   * `useHealthConnect().connect()` is therefore a no-op. With this set the sheet
   * opens as a *preview* of the permission request — every read, named — and the
   * footer arms the offer instead of pretending to connect. Onboarding then
   * honours that armed tap the moment an account exists.
   */
  onArm?: () => void;
}

const StatusLine = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <p className={`flex items-start gap-1.5 text-[12px] leading-relaxed ${ok ? "text-emerald-300" : "text-amber-300/90"}`}>
    {ok ? <Check size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
    <span>{children}</span>
  </p>
);

const HealthConnectPrompt = ({ open, onClose, onArm }: HealthConnectPromptProps) => {
  const navigate = useNavigate();
  const hc = useHealthConnect();
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);

  // Both halves of the gate: the plugin only exists on Android, and the whole
  // surface is behind the launch flag.
  const offered = isAndroid() && isFlagOn("wearableSync");
  const connected = hc.status === "connected";
  // No session to connect with, so this visit is a promise rather than an
  // action. Checked before anything reads hook state: on this screen the hook's
  // status is meaningless (there is no user to resolve it against).
  const pendingSession = typeof onArm === "function";

  // Every read, named before anybody is asked to approve one. Shared by the
  // connect path and the sign-up preview so the two lists can never drift.
  const permissionList = (
    <div className="space-y-1.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        Read access only
      </p>
      {HEALTH_PERMISSION_LIST.map(([key, spec]) => (
        <div key={key} className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold">{spec.label}</p>
          <p className="max-w-[62%] text-right text-[12px] text-muted-foreground">{spec.why}</p>
        </div>
      ))}
    </div>
  );

  const connect = async () => {
    setBusy("connect");
    try {
      // Status is re-read by the hook itself, so the sheet re-renders into the
      // connected state (with the first sync) on its own. Deliberately no
      // success toast: a declined grant returns here too, and a toast cannot
      // tell the difference without lying to somebody who just said no.
      await hc.connect();
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      await hc.sync();
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    const confirmed = confirm(
      "Disconnect Health Connect? Vaylo will stop reading your health data. Already-imported workouts stay until you delete them or your account.",
    );
    if (!confirmed) return;
    setBusy("disconnect");
    try {
      await hc.disconnect();
    } finally {
      setBusy(null);
    }
  };

  const body = () => {
    if (pendingSession) {
      return (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Your watch already writes into Health Connect on your phone. Approve these reads and the
            workouts, heart rate, sleep, steps and calories land in your log as normal sessions — no
            retyping, and nothing to set up per watch.
          </p>
          {permissionList}
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Nothing is read now — there is no Vaylo account to read it into yet. Say yes and we will
            ask Health Connect for exactly this, once, the moment you are signed in.
          </p>
        </div>
      );
    }

    if (!offered) {
      return (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Health Connect runs on Android. Open Vaylo Sports on your Android phone to connect the
          watch that already writes into it — nothing is read on this device.
        </p>
      );
    }

    if (hc.checking) {
      return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Checking Health Connect…
        </p>
      );
    }

    if (hc.apiStatus === "update_required") {
      return (
        <div className="space-y-3">
          <StatusLine ok={false}>
            Health Connect needs an update before Vaylo Sports can read from it.
          </StatusLine>
          <Button
            onClick={() => void hc.managePermissions()}
            variant="outline"
            className="w-full h-11 rounded-xl"
          >
            <ExternalLink size={14} className="mr-1.5" /> Open Health Connect
          </Button>
        </div>
      );
    }

    if (connected) {
      return (
        <div className="space-y-3">
          <StatusLine ok>Connected. Vaylo reads only the six types below, and never writes.</StatusLine>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {hc.syncState.lastSyncAt
              ? `Last sync ${new Date(hc.syncState.lastSyncAt).toLocaleString()}.`
              : "No sync yet — the first one imports your recent sessions."}
          </p>
          {hc.error && <StatusLine ok={false}>{hc.error}</StatusLine>}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void hc.managePermissions()}
              variant="outline"
              className="h-10 flex-1 rounded-xl"
            >
              <ShieldCheck size={14} className="mr-1.5" /> Permissions
            </Button>
            <Button
              onClick={() => void disconnect()}
              disabled={busy !== null}
              variant="outline"
              aria-label="Disconnect Health Connect"
              className="h-10 flex-1 rounded-xl border-destructive/30 bg-destructive/10 text-destructive"
            >
              {busy === "disconnect" ? (
                <Loader2 size={14} className="mr-1 animate-spin" />
              ) : (
                <Unlink size={14} className="mr-1" />
              )}
              Disconnect
            </Button>
          </div>
          <button
            type="button"
            onClick={() => { onClose(); navigate("/health-sync"); }}
            className="w-full text-[12px] font-semibold text-primary hover:underline"
          >
            Open the full Wearables screen
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your watch already writes into Health Connect on your phone. Connect it once here and the
          workouts, heart rate, sleep, steps and calories land in your log as normal sessions — no
          retyping, and nothing to set up per watch.
        </p>
        {permissionList}
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Android asks you to approve each type itself, and you can take any of them back there at
          any time. Vaylo never sells this data, never uses it for advertising, and deletes it with
          your account.
        </p>
        {hc.error && <StatusLine ok={false}>{hc.error}</StatusLine>}
      </div>
    );
  };

  // The catch-all footer: one control that cannot be acted on is worse than no
  // control, so "Close" is the honest action whenever the body itself is the
  // instruction (no plugin, or Health Connect needs updating first). Without
  // this, an out-of-date Health Connect showed "Open Health Connect" in the body
  // *and* a connect button underneath it — the second of which could only fail.
  const closeOnly = (
    <Button onClick={onClose} variant="outline" className="w-full h-11 rounded-xl">
      Close
    </Button>
  );

  const footer = pendingSession ? (
    <Button
      onClick={() => {
        onArm?.();
        onClose();
      }}
      className="w-full h-11 rounded-xl bg-gradient-primary text-primary-foreground font-semibold"
    >
      <Check size={14} className="mr-1.5" /> {HEALTH_CONNECT_ARM_CTA}
    </Button>
  ) : !offered || hc.apiStatus === "update_required" ? (
    closeOnly
  ) : connected ? (
    <Button
      onClick={() => void sync()}
      disabled={busy !== null}
      className="w-full h-11 rounded-xl bg-gradient-primary text-primary-foreground font-semibold"
    >
      {busy === "sync" ? (
        <>
          <Loader2 size={14} className="mr-1.5 animate-spin" /> Syncing…
        </>
      ) : (
        <>
          <RefreshCw size={14} className="mr-1.5" /> Sync now
        </>
      )}
    </Button>
  ) : hc.checking ? undefined : (
    <div className="flex gap-2">
      <Button onClick={onClose} variant="outline" className="h-11 rounded-xl px-4">
        Not now
      </Button>
      <Button
        onClick={() => void connect()}
        disabled={busy !== null || hc.connecting}
        className="h-11 flex-1 rounded-xl bg-gradient-primary text-primary-foreground font-semibold"
      >
        {busy === "connect" || hc.connecting ? (
          <>
            <Loader2 size={14} className="mr-1.5 animate-spin" /> Connecting…
          </>
        ) : (
          HEALTH_CONNECT_CTA
        )}
      </Button>
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={connected ? "Health Connect" : "Bring your training with you"}
      subtitle={
        connected
          ? "Connected — Vaylo reads only what you approved."
          : pendingSession
            ? "Approve now, connect the moment your account exists."
            : "Sync the watch you already wear, without logging a single session by hand."
      }
      leading={
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
          <Smartphone size={16} className="text-primary" aria-hidden />
        </span>
      }
      footer={footer}
    >
      {body()}
    </BottomSheet>
  );
};

export default HealthConnectPrompt;
