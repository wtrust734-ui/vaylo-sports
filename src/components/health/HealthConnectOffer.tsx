import { useEffect, useState } from "react";

import HealthConnectPrompt from "@/components/health/HealthConnectPrompt";
import { useHealthConnect } from "@/hooks/useHealthConnect";
import { useAuth } from "@/contexts/AuthContext";
import {
  clearHealthConnectOffer,
  healthConnectOfferArmed,
  healthConnectPrompted,
  markHealthConnectPrompted,
} from "@/lib/health/connectOffer";

// ============================================================================
// The onboarding Health Connect offer — decides WHEN to ask
// ----------------------------------------------------------------------------
// MOUNT THIS ONLY WHERE THE PLUGIN EXISTS (`isAndroid() && isFlagOn("wearableSync")`).
// The gate is the call site's job on purpose: `useHealthConnect()` reads the
// athlete's sync state as soon as it runs, and a build with no Health Connect
// must not pay for a query about a feature it cannot offer. That is also why
// the visibility is controlled by the parent rather than owned here — one
// instance of the hook, one sheet, one place the row lives.
//
// Two things open the pop-up, and neither is a nag:
//
//   * the athlete tapped "Connect my Health Connect" on the sign-up screen,
//     where there is deliberately no session yet to connect with — that tap is
//     armed in lib/health/connectOffer and honoured here, so the promise made
//     on the previous screen is kept;
//   * or they reached the last step of onboarding and have never been asked.
//
// Either way it is asked at most once per account, and never when Health
// Connect is already connected.
// ============================================================================

export interface HealthConnectOfferProps {
  open: boolean;
  /** Called by the offer when it decides the athlete should be asked. */
  onOpen: () => void;
  onClose: () => void;
  /** True while the athlete is on the final onboarding step. */
  onLastStep: boolean;
}

const HealthConnectOffer = ({ open, onOpen, onClose, onLastStep }: HealthConnectOfferProps) => {
  const { user } = useAuth();
  const hc = useHealthConnect();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!user || settled || hc.checking) return;
    if (hc.status === "connected") {
      // Nothing left to promise: the connection happened by another route
      // (probably the Wearables screen), so the armed tap is spent.
      clearHealthConnectOffer();
      setSettled(true);
      return;
    }
    const armed = healthConnectOfferArmed();
    if (armed || (onLastStep && !healthConnectPrompted(user.id))) {
      markHealthConnectPrompted(user.id);
      clearHealthConnectOffer();
      onOpen();
      setSettled(true);
    }
  }, [user, settled, hc.checking, hc.status, onLastStep, onOpen]);

  return <HealthConnectPrompt open={open} onClose={onClose} />;
};

export default HealthConnectOffer;
