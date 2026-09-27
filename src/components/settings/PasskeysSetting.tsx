import { useEffect, useState } from "react";
import { Fingerprint, Plus, Check } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { fetchAuthMethods, passkeySupported } from "@/hooks/use-auth-providers";

/**
 * Passkey management (Profile → Settings).
 *
 * Registration only: supabase.auth.registerPasskey() runs the WebAuthn
 * ceremony for the signed-in athlete and attaches a new credential to their
 * account. Sign-in with an existing passkey lives on the Auth page. The block
 * is hidden entirely unless the project has passkeys enabled AND this device
 * can run the ceremony — matching how the auth page gates its passkey button.
 */
export default function PasskeysSetting() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    let active = true;
    fetchAuthMethods().then((m) => {
      if (active) setAvailable(m.passkeys && passkeySupported());
    });
    return () => {
      active = false;
    };
  }, []);

  if (available === null || !available) return null;

  const handleRegister = async () => {
    setRegistering(true);
    try {
      const { error } = await supabase.auth.registerPasskey();
      if (error) throw error;
      setRegistered(true);
      toast({
        title: t("settings.passkeys.saved", "Passkey saved"),
        description: t(
          "settings.passkeys.savedDesc",
          "You can now sign in with this device's fingerprint, face or PIN.",
        ),
      });
    } catch (error) {
      // A cancelled browser prompt is a normal outcome, not an error worth a red toast.
      const message = error instanceof Error ? error.message : String(error);
      if (!/cancel|abort|not allowed/i.test(message)) {
        toast({
          title: t("settings.passkeys.failed", "Couldn't save passkey"),
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div>
      <label className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
        <Fingerprint size={12} /> {t("settings.passkeys.title", "Passkeys")}
      </label>
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={registered ? undefined : handleRegister}
        disabled={registering || registered}
        className={`w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium border transition-all ${
          registered
            ? "bg-primary/10 border-primary/40 text-primary"
            : "bg-muted border-border text-foreground hover:border-primary/40 disabled:opacity-60"
        }`}
      >
        {registered ? <Check size={16} className="text-primary" /> : <Plus size={16} />}
        {registered
          ? t("settings.passkeys.registered", "Passkey registered on this device")
          : registering
            ? t("settings.passkeys.working", "Waiting for your device…")
            : t("settings.passkeys.add", "Add a passkey for this device")}
      </motion.button>
      <p className="text-[11px] text-muted-foreground mt-2">
        {t(
          "settings.passkeys.description",
          "Sign in with your fingerprint, face or device PIN — no password needed.",
        )}
      </p>
    </div>
  );
}
