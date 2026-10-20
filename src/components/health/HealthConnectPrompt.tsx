import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unlink,
} from "lucide-react";

import BottomSheet from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { useHealthConnect } from "@/hooks/useHealthConnect";
import { HEALTH_PERMISSION_LIST } from "@/lib/health/permissions";
import { isAndroid } from "@/lib/platform";
import { isFlagOn } from "@/config/featureFlags";
import { formatDateTimeExact } from "@/i18n/format";

// ============================================================================
// The "connect your watch" pop-up
// ----------------------------------------------------------------------------
// One sheet, three entry points (sign-up, onboarding and Profile), because the
// reasons to open it are the things an athlete actually needs:
//
//   * connect, for the first time, from wherever the athlete is;
//   * manage, once connected: sync now, fix a revoked permission, delete the
//     imported data, or stop the app reading anything.
//
// It is the only Health Connect surface: the sheet's own `useHealthConnect()`
// is the one implementation of consent, sync, delete and disconnect.
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

/** The six reads, in one line, for the state where they are already granted.
 *  Derived from the permission catalog so it cannot drift from what the native
 *  request actually asks for. */
const READ_LABELS = HEALTH_PERMISSION_LIST.map(([, spec]) => spec.label).join(" · ");

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
  const hc = useHealthConnect();
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);

  // Both halves of the gate: the plugin only exists on Android, and the whole
  // surface is behind the launch flag.
  const offered = isAndroid() && isFlagOn("wearableSync");
  const connected = hc.status === "connected";
  // Permissions once granted can be taken back in Health Connect at any time.
  // The old sheet had no word for that state: it fell through to "not
  // connected" and showed the full first-run pitch — "connect it once here…"
  // — to an athlete who had ALREADY connected and synchronised. Calling the
  // setup flow redundant is generous: it asked to build the thing that was
  // already built. This state gets its own branch and its own verb.
  const permissionsIncomplete = hc.status === "permission_required";
  // The sync axis — which the old sheet also lacked, so "connected" quietly
  // stood in for "synchronised" and a failed first import looked identical
  // to a user who had never connected at all.
  const syncStatus = hc.syncStatus;
  const everSynced = hc.syncState.lastSyncAt != null || syncStatus === "succeeded";
  const lastSyncFailed = syncStatus === "failed" || (hc.error != null && everSynced === false && syncStatus !== "in_progress");
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

  const deleteImported = async () => {
    const confirmed = confirm(
      "Delete ALL imported health data (workouts, samples, sleep, heart rate)? This cannot be undone.",
    );
    if (!confirmed) return;
    await hc.deleteImported();
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

    if (permissionsIncomplete) {
      return (
        <div className="space-y-3">
          <StatusLine ok={false}>
            Health Connect permissions were changed — Vaylo is connected, but some reads were taken
            back. Your imported data is untouched.
          </StatusLine>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Re-approve the reads below and syncing resumes. Nothing was read while the permissions
            were missing, and no data was overwritten.
          </p>
          {permissionList}
          {hc.error && <StatusLine ok={false}>{hc.error}</StatusLine>}
        </div>
      );
    }

    if (connected) {
      return (
        <div className="space-y-3">
          <StatusLine ok>Connected. Vaylo reads only what you approved, and never writes.</StatusLine>
          {/* The line above used to say "the six types below" while the list of
              them was rendered on the *connect* path only — so once connected,
              the sheet named a list that was not on screen. A privacy screen
              has to name what it is reading, so it names it here. */}
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Reading {READ_LABELS} — nothing else.
          </p>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {hc.syncState.lastSyncAt
              ? `Last sync ${formatDateTimeExact(new Date(hc.syncState.lastSyncAt))}.`
              : "No sync yet — the first one imports your recent sessions."}
          </p>
          {lastSyncFailed && (
            <StatusLine ok={false}>
              The last sync didn't complete — what was already imported is unchanged, and picking up
              below resumes from where it left off.
            </StatusLine>
          )}
          {hc.error && !lastSyncFailed && <StatusLine ok={false}>{hc.error}</StatusLine>}
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Disconnecting stops future syncs but keeps what was already imported. Delete imported
            data to erase those workouts and samples from Vaylo now.
          </p>
          <Button
            onClick={() => void deleteImported()}
            disabled={busy !== null || hc.deleting}
            variant="outline"
            className="w-full h-10 rounded-xl border-destructive/30 bg-destructive/10 text-destructive"
          >
            {hc.deleting ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Trash2 size={14} className="mr-1.5" />
            )}
            Delete imported data
          </Button>
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

  const syncButton = (label: string) => (
    <Button
      onClick={() => void sync()}
      disabled={busy !== null || syncStatus === "in_progress"}
      className="h-11 flex-1 rounded-xl bg-gradient-primary text-primary-foreground font-semibold"
    >
      {busy === "sync" || syncStatus === "in_progress" ? (
        <>
          <Loader2 size={14} className="mr-1.5 animate-spin" /> Syncing…
        </>
      ) : (
        <>
          <RefreshCw size={14} className="mr-1.5" /> {label}
        </>
      )}
    </Button>
  );

  /**
   * The THREE sync actions, and the rule that separates them:
   *
   *   * never synced          → "Sync now" is the FIRST import — the
   *                             second half of the setup flow;
   *   * last run failed        → "Retry sync" — the genuine retry path, run
   *                             from the stored cursor (nothing was lost);
   *   * synchronised           → "Done" primary, "Sync new data" beside it —
   *                             a distinct, explicitly manual resync action,
   *                             NOT a repeat of the setup flow. A future sync
   *                             stays available exactly because this button
   *                             never disappears; what disappears is the
   *                             setup, which has nothing left to do.
   */
  const syncActionLabel =
    syncStatus === "failed"
      ? // The doc comment above promises this verb to every failed run — a run
        // that failed before any batch arrived (no cursor) is still a retry of
        // the sync, not a calm first ask.
        "Retry sync"
      : syncStatus === "succeeded" || everSynced
        ? "Sync new data"
        : "Sync now";

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
  ) : permissionsIncomplete ? (
    /* The reconnect path. A distinct verb for permission repair — same grant
       flow, different promise — so the sheet never re-offers the *initial*
       setup to an athlete who already did their setup. */
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
          "Reconnect permissions"
        )}
      </Button>
    </div>
  ) : connected ? (
    /* Connected is the state an athlete comes back to, and it used to offer one
       footer control: "Sync now". A sheet whose only prominent action is not an
       exit reads as a trap — the header X was the sole way out, and the first
       thing reported about this screen was that it could not be dismissed.
       "Done" is secondary-permanent now, and the sync half labels itself: first
       import, retry, or a clearly manual resync of new data — one verb per
       reality, and never a repeat of the setup flow that already finished. */
    <div className="flex gap-2">
      <Button onClick={onClose} variant="outline" className="h-11 rounded-xl px-4">
        Done
      </Button>
      {syncActionLabel === "Retry sync" ? (
        syncButton(syncActionLabel)
      ) : (
        /* Synchronised state puts the manual resync SECOND: the athlete's most
           likely want is to leave, and pressing Sync again without new data is
           a no-cost no-op — the dedupe lock and the conflict-safe upserts make
           it harmless, and the label refrains from promising an import. */
        <>
          <div className="flex-1" />
          {syncButton(syncActionLabel)}
        </>
      )}
    </div>
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
      /* Above every app-level surface (offline banner and promo pop-ups at 70,
         the terms-change notice and streak shield at 65, the credit warning at
         60). Those sit above the default bottom-sheet rung at z-[59] on
         purpose — but this sheet is opened from three different screens and
         the two bottom-anchored ones (the terms notice at
         `bottom-[calc(...)+5.5rem]`, the credit warning in the same place) land
         squarely on this sheet's footer, where they took the taps meant for
         its own buttons. Nothing may cover a modal the athlete is inside. */
      z="z-[71]"
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
