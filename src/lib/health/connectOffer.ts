// ============================================================================
// VAYLO HEALTH — the "connect your watch" offer, remembered across screens
// ----------------------------------------------------------------------------
// Two facts have to survive a screen change, and neither belongs in a component:
//
//   1. The offer was *asked for*. Health Connect can only be connected once a
//      session exists, and the sign-up screen is the one place in the app where
//      there deliberately is none (Auth.tsx bounces a signed-in visitor away).
//      So a tap there is a promise, not an action: it is armed here and kept
//      until onboarding can honour it.
//
//   2. It has already been asked. The offer is a pop-up, and a pop-up that
//      reappears every time the athlete walks back through onboarding is nagging.
//      One ask per account, remembered per account.
//
// Both are device state, not account state: nothing here is uploaded, and every
// accessor is total — private mode, a disabled store and a corrupt value all
// read as "not armed" / "not asked" rather than throwing into a render.
// ============================================================================

/** Armed by an explicit tap on the sign-up screen. Device-wide, not per user:
 *  the tap happens before an account exists to key it to. */
const OFFER_KEY = "vaylo:hc:offer";

/** Set the first time the offer is shown to an account. */
const PROMPTED_KEY = (userId: string) => `vaylo:hc:offer-asked:${userId}`;

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — the offer simply does not persist */
  }
};

/** Records that the athlete asked for the offer and the connection was not yet
 *  possible (no session). */
export const armHealthConnectOffer = (): void => write(OFFER_KEY, "1");

/** True while an armed offer is waiting to be honoured. */
export const healthConnectOfferArmed = (): boolean => read(OFFER_KEY) === "1";

/** Clears the armed offer — after it has been honoured, or when there is nothing
 *  left to connect. */
export const clearHealthConnectOffer = (): void => write(OFFER_KEY, null);

/** True when this account has already been asked. */
export const healthConnectPrompted = (userId: string): boolean =>
  read(PROMPTED_KEY(userId)) === "1";

/** Records that this account has been asked, so the pop-up does not return. */
export const markHealthConnectPrompted = (userId: string): void =>
  write(PROMPTED_KEY(userId), "1");
