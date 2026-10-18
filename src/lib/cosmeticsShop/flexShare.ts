// ============================================================================
// FLEX SHARE — capture the card, hand it to the OS share sheet
// ----------------------------------------------------------------------------
// This is the web-stack answer to react-native-view-shot + react-native-share:
//
//   capture  html2canvas (already a production dependency of this app) turns
//            the rendered FlexCard DOM node into a PNG at 2× for crispness.
//   share    Web Share API Level 2 — navigator.share({ files }) — which the
//            Android WebView behind the APK supports, and which desktop
//            browsers increasingly do. When the environment cannot share
//            files (no navigator.share, insecure context, older WebView), it
//            degrades the way src/lib/share.ts already degrades: text share /
//            invite link / clipboard, via the same shareContent helper. A
//            flex that cannot ship its image still ships its caption.
//
// Failure handling mirrors the house style in share.ts: a dismissed share
// sheet is a HANDLED outcome ("shared"), not an error; only genuine capture
// failure falls through to the text path.
// ============================================================================

import html2canvas from "html2canvas";

import { shareContent, type ShareResult } from "@/lib/share";
import { RARITY_LADDER, type CosmeticItem, type CosmeticRarity } from "./types";

/** Emoji per tier — none for common/rare, escalating hype above. */
const RARITY_EMOJI: Record<CosmeticRarity, string> = {
  common: "✨",
  rare: "✨",
  epic: "⚡",
  legendary: "🔥",
  mythic: "👑",
};

/** The card's header line, shared between the visual card and the caption. */
export const flexHeadline = (rarity: CosmeticRarity): string => {
  switch (rarity) {
    case "mythic": return "NEW MYTHIC UNLOCKED!";
    case "legendary": return "LEGENDARY STATUS ACHIEVED";
    case "epic": return "EPIC UNLOCK";
    default: return "NEW UNLOCK";
  }
};

/**
 * The pre-written viral caption. Deliberately boastful-but-playful ("can you
 * catch up?") — challenge framing, never pressure; sharing is always the
 * athlete's choice and the caption is only ever attached when they share.
 */
export const flexCaption = (item: CosmeticItem, appName = "Vaylo Sports"): string =>
  `Just unlocked the ${RARITY_LADDER[item.rarity].label} ${item.name} on ${appName}! ` +
  `Can you catch up? ${RARITY_EMOJI[item.rarity]}`;

/** Render a DOM node to a PNG blob at 2× scale. Throws on capture failure. */
export const captureNodeToPngBlob = async (node: HTMLElement): Promise<Blob> => {
  const canvas = await html2canvas(node, { backgroundColor: null, scale: 2, logging: false });
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("flex-share: canvas produced no image"));
    }, "image/png");
  });
};

/** True when this environment can share an image file through the OS sheet. */
export const canShareImage = (blob: Blob): boolean => {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  const file = new File([blob], "vaylo-flex-card.png", { type: "image/png" });
  return typeof navigator.canShare === "function" ? navigator.canShare({ files: [file] }) : false;
};

/**
 * Capture the card and share it. Returns how it landed:
 *   "shared"     — image went to the OS sheet (or the sheet was dismissed,
 *                  which counts as handled, matching share.ts conventions);
 *   "copied"     — no image path available; the caption reached the clipboard;
 *   "unsupported"— nothing could be shared in this environment.
 * Capture failures are NOT thrown at the caller — they degrade to the caption
 * path, because a broken screenshot must not eat the athlete's moment.
 */
export const shareFlexCard = async (node: HTMLElement, caption: string): Promise<ShareResult> => {
  try {
    const blob = await captureNodeToPngBlob(node);
    if (canShareImage(blob)) {
      const file = new File([blob], "vaylo-flex-card.png", { type: "image/png" });
      try {
        await navigator.share({ files: [file], text: caption });
        return "shared";
      } catch {
        // Dismissed sheet — handled, same as shareContent treats it.
        return "shared";
      }
    }
  } catch {
    // Capture unsupported/tainted — fall through to the caption path.
  }
  return shareContent({ title: "New unlock", text: caption });
};
