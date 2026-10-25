import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Infinity as InfinityIcon, Zap, X, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { redeemFriendCode } from "@/lib/friends";

/**
 * APP-ACCESS CODE — one input, one outcome: unlimited credits.
 *
 * This screen is the only gate before the app. There is no sign-in, no free
 * grant and no paywall. The athlete either unlocks with the code or gets
 * nothing more than a landing screen.
 *
 * The code 220147 is the single key that turns an account with zero credits
 * into an account with unlimited credits. Once unlocked, every feature in
 * the app is permanently open: no packs, no subscriptions, no per-use
 * charges, no hidden gates. The credit system as a market has been removed;
 * this is the one place credits still exist, and it exists purely to
 * acknowledge that one person (the owner) needed a way in.
 */

const CODE = "220147";

export default function RedeemCode() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If we already have a code (never happens in practice, but keeps the
  // screen from re-prompting after a successful unlock), direct straight in.
  if (user) {
    return (
      <div className="min-h-screen bg-background pb-28">
        <div className="px-5 pt-[var(--vaylo-screen-top)]">
          <div className="mx-auto max-w-md text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-electric-purple to-energy">
              <InfinityIcon size={32} className="text-white" />
            </div>
            <h1 className="mt-4 font-display text-2xl font-bold">Unlocked</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Unlimited credits. Every feature open. No more prompts.
            </p>
            <Button onClick={() => navigate("/")} className="mt-4">
              Go to home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="px-5 pt-[var(--vaylo-screen-top)]">
        <div className="mx-auto max-w-md text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-electric-purple to-energy">
            <InfinityIcon size={28} className="text-white" />
          </div>
          <h1 className="font-display text-2xl font-bold leading-tight">
            Enter the code to continue
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This app is for the owner only. Enter the code to get unlimited
            credits — every feature is then permanently open.
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => setCode(CODE)}>
              <Zap size={16} />
              Auto-fill 220147
            </Button>
            <Button variant="outline" onClick={() => navigate("/")}>
              <CreditCard size={16} />
              Cancel
            </Button>
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-card/50 p-6">
            <label htmlFor="code" className="block text-sm font-semibold mb-2">
              Friend code
            </label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 220147"
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm font-mono focus:border-energy focus:outline-none focus:ring-2 focus:ring-energy/20"
              maxLength={8}
              autoComplete="off"
            />
            {error && (
              <p className="mt-2 text-sm text-red-400">{error}</p>
            )}
            <Button
              onClick={async () => {
                if (!code.trim()) return;
                setBusy(true);
                setError(null);
                const result = await redeemFriendCode(code.trim());
                setBusy(false);
                if (result.ok) {
                  window.location.href = "/";
                } else {
                  setError(result.error ?? "Could not redeem that code.");
                }
              }}
              disabled={!code.trim() || busy}
              className="mt-4 w-full bg-gradient-to-r from-electric-purple to-energy hover:opacity-90 text-white font-semibold py-3"
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Unlocking…
                </span>
              ) : (
                <>
                  <InfinityIcon size={18} />
                  Get unlimited credits
                </>
              )}
            </Button>
            <p className="mt-3 text-[11px] text-muted-foreground">
              <code className="rounded bg-muted/50 px-1 py-0.5 font-mono text-[10px]">
                {CODE}
              </code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
