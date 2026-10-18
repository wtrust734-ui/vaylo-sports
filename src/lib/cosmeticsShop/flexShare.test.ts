// ============================================================================
// FLEX SHARE — caption shape and the degradation ladder
// ----------------------------------------------------------------------------
// Pins the three outcomes the share util promises: image to the OS sheet
// when the environment supports it, caption-only fallback when it does not,
// and a capture failure that STILL ships the caption instead of eating the
// moment. html2canvas and shareContent are both mocked — this is a test of
// the branching, not of the renderer or the sheet.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOCK_CATALOG } from "./catalog";
import { canShareImage, captureNodeToPngBlob, flexCaption, flexHeadline, shareFlexCard } from "./flexShare";

vi.mock("html2canvas", () => ({
  default: vi.fn(async () => ({
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["png"], { type: "image/png" })),
  })),
}));

vi.mock("@/lib/share", () => ({
  shareContent: vi.fn(async () => "copied" as const),
}));

import html2canvas from "html2canvas";
import { shareContent } from "@/lib/share";

const item = (id: string) => MOCK_CATALOG.find((i) => i.id === id)!;
const node = () => document.createElement("div");

const setNavigatorShare = (share: unknown, canShare: unknown) => {
  Object.defineProperty(window.navigator, "share", { value: share, configurable: true });
  Object.defineProperty(window.navigator, "canShare", { value: canShare, configurable: true });
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => setNavigatorShare(undefined, undefined));

describe("captions and headlines", () => {
  it("builds the viral caption around rarity, item and app", () => {
    const cap = flexCaption(item("title_goat"));
    expect(cap).toContain("Mythic");
    expect(cap).toContain("GOAT");
    expect(cap).toContain("Vaylo Sports");
    expect(cap).toContain("Can you catch up?");
    expect(cap).toContain("👑");
  });

  it("headline escalates with rarity and matches the card's header source", () => {
    expect(flexHeadline("mythic")).toBe("NEW MYTHIC UNLOCKED!");
    expect(flexHeadline("legendary")).toBe("LEGENDARY STATUS ACHIEVED");
    expect(flexHeadline("epic")).toBe("EPIC UNLOCK");
    expect(flexHeadline("rare")).toBe("NEW UNLOCK");
  });
});

describe("shareFlexCard", () => {
  it("sends the image to the OS sheet when files can be shared", async () => {
    const share = vi.fn(async (_payload: unknown) => undefined);
    setNavigatorShare(share, () => true);
    const result = await shareFlexCard(node(), "cap");
    expect(result).toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    const payload = share.mock.calls[0][0] as { files?: File[]; text?: string };
    expect(payload.files?.[0]?.name).toBe("vaylo-flex-card.png");
    expect(payload.text).toBe("cap");
    expect(shareContent).not.toHaveBeenCalled();
  });

  it("degrades to the caption path when files cannot be shared", async () => {
    setNavigatorShare(undefined, () => false);
    const result = await shareFlexCard(node(), "cap");
    expect(result).toBe("copied");
    expect(shareContent).toHaveBeenCalledWith(expect.objectContaining({ text: "cap" }));
  });

  it("a capture failure still ships the caption", async () => {
    vi.mocked(html2canvas).mockRejectedValueOnce(new Error("tainted canvas"));
    setNavigatorShare(vi.fn(), () => true); // even though files COULD be shared
    const result = await shareFlexCard(node(), "cap");
    expect(result).toBe("copied");
    expect(shareContent).toHaveBeenCalledWith(expect.objectContaining({ text: "cap" }));
  });

  it("a dismissed share sheet counts as handled, not an error", async () => {
    setNavigatorShare(vi.fn(async () => { throw new Error("AbortError: cancelled"); }), () => true);
    const result = await shareFlexCard(node(), "cap");
    expect(result).toBe("shared");
  });
});

describe("capture + capability probe", () => {
  it("captureNodeToPngBlob resolves a png blob", async () => {
    const blob = await captureNodeToPngBlob(node());
    expect(blob.type).toBe("image/png");
  });

  it("canShareImage is false without navigator.share", () => {
    setNavigatorShare(undefined, undefined);
    expect(canShareImage(new Blob(["x"]))).toBe(false);
  });
});
