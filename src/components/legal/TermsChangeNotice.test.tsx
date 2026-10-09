// ============================================================================
// THE RE-ACCEPTANCE PROMPT, RENDERED
// ---------------------------------------------------------------------------
// src/lib/termsReacceptance.test.ts checks the wiring by reading the source:
// where it is mounted, in what order it writes and hides, and that it has no
// dismiss path. None of that proves the banner appears for an athlete who is
// behind and stays away from one who is not — which is the whole feature.
//
// So this file renders it against a fake auth context. The states that matter:
//
//   * a profile recorded against an older version  → the prompt, naming both
//   * a profile recorded against an unknown version → still the prompt, because
//     "never recorded" is behind by definition
//   * a profile already on the current version     → nothing
//   * no profile at all                            → nothing
//   * a write that did not land                    → the prompt STAYS, with the
//     reason, and the profile is not re-read
//
// That last one is the test the feature needed most. `recordTermsAcceptance`
// used to return nothing and swallow its error, so an earlier draft of this
// component hid the banner while the consent silently failed to save — telling
// the athlete something that was not true, which is the exact failure the notice
// exists to prevent.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import TermsChangeNotice from "@/components/legal/TermsChangeNotice";
import { TERMS_VERSION, recordTermsAcceptance } from "@/lib/consent";
import { COOKIE_NOTICE_KEY, COOKIE_NOTICE_VERSION, rememberCookieConsent } from "@/lib/cookieNotice";
import { useAuth } from "@/contexts/AuthContext";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/consent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/consent")>();
  return { ...actual, recordTermsAcceptance: vi.fn() };
});

const HEADING = "We have updated the Terms of Service";

const LocationProbe = () => <span data-testid="where">{useLocation().pathname}</span>;

function renderNotice(profile: { terms_version: string | null } | null) {
  const refreshProfile = vi.fn().mockResolvedValue(undefined);
  // `null` means NO profile — signed out, or the row has not loaded — and that is
  // a different state from a profile whose version was never recorded. The
  // helper used to collapse them (`profile?.terms_version ?? null`), so the
  // "no profile" case was really "a profile with a null version" and asserted
  // the opposite of what its name says: nothing is known → stay silent, versus
  // nothing was recorded → behind by definition, ask.
  // Typed by what the component actually reads off the hook, rather than cast to
  // `any`: the mocked useAuth only has to answer with a profile and a refresh.
  const authMock = useAuth as unknown as { mockReturnValue: (value: unknown) => void };
  authMock.mockReturnValue({
    profile: profile === null ? null : { terms_version: profile.terms_version },
    refreshProfile,
  });

  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <TermsChangeNotice />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

  return { refreshProfile };
}

beforeEach(() => {
  vi.mocked(recordTermsAcceptance).mockResolvedValue(true);
  // The fixture settles the storage notice. The two bottom cards are shown one
  // at a time and the storage notice goes first, so an unacknowledged notice
  // would (correctly) keep this banner off screen and every test below would be
  // asserting against an empty document. The priority rule itself is asserted
  // in its own test under "when there is nothing to ask".
  localStorage.setItem(COOKIE_NOTICE_KEY, COOKIE_NOTICE_VERSION);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("when the athlete is behind", () => {
  it("shows the prompt and names both versions", () => {
    renderNotice({ terms_version: "1.0" });

    expect(screen.getByText(HEADING)).toBeInTheDocument();
    expect(screen.getByText(/version 1\.0/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /I accept version 1\.4/ }),
    ).toBeInTheDocument();
  });

  it("treats a version that was never recorded as behind, not as current", () => {
    // Every account created before the consent columns existed is in this
    // state. Reading null as "fine" would leave the largest group of athletes
    // permanently unprompted.
    renderNotice({ terms_version: null });

    expect(screen.getByText(HEADING)).toBeInTheDocument();
    expect(screen.getByText(/an earlier version/i)).toBeInTheDocument();
  });
});

describe("when there is nothing to ask", () => {
  it("stays away from an athlete already on the current version", () => {
    renderNotice({ terms_version: TERMS_VERSION });
    expect(screen.queryByText(HEADING)).not.toBeInTheDocument();
  });

  it("stays away when there is no profile to judge", () => {
    renderNotice(null);
    expect(screen.queryByText(HEADING)).not.toBeInTheDocument();
  });

  it("waits its turn while the storage notice is still owed", () => {
    // One card at a time, at the same corner of a 390x844 screen: stacked, the
    // storage notice's text showed through this banner's translucent card.
    // The storage notice is the one that cannot be remembered, so it goes first
    // and this banner returns once it has been answered.
    localStorage.removeItem(COOKIE_NOTICE_KEY);

    renderNotice({ terms_version: "1.0" });

    expect(screen.queryByText(HEADING)).not.toBeInTheDocument();
  });

  it("comes forward the moment the storage notice is answered", async () => {
    // The other half of "one at a time", and the half that was missing. This
    // banner is second in the queue, so the read that decides it has to react to
    // the storage notice being answered — a plain read per render left the
    // corner empty until something unrelated re-rendered the banner (a
    // navigation, or a profile refresh), which is a long wait to be told the
    // Terms changed.
    localStorage.removeItem(COOKIE_NOTICE_KEY);

    renderNotice({ terms_version: "1.0" });
    expect(screen.queryByText(HEADING)).not.toBeInTheDocument();

    // Exactly what the storage notice's Accept button does.
    await act(async () => {
      rememberCookieConsent();
    });

    await waitFor(() => expect(screen.getByText(HEADING)).toBeInTheDocument());
  });
});

describe("accepting", () => {
  it("records the acceptance, then leaves", async () => {
    const { refreshProfile } = renderNotice({ terms_version: "1.0" });

    fireEvent.click(screen.getByRole("button", { name: /I accept version 1\.4/ }));

    await waitFor(() => expect(recordTermsAcceptance).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(HEADING)).not.toBeInTheDocument());
    expect(refreshProfile).toHaveBeenCalled();
  });

  it("stays put, and says so, when the record was not written", async () => {
    vi.mocked(recordTermsAcceptance).mockResolvedValue(false);
    const { refreshProfile } = renderNotice({ terms_version: "1.0" });

    fireEvent.click(screen.getByRole("button", { name: /I accept version 1\.4/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not save that/i);
    // The prompt must still be there: the athlete has not accepted anything yet.
    expect(screen.getByText(HEADING)).toBeInTheDocument();
    // And the profile is not re-read on a failed write, because there is
    // nothing new to read.
    expect(refreshProfile).not.toHaveBeenCalled();
  });
});

describe("the routes out of the prompt", () => {
  it("opens the Terms as an in-app document, not an external site", async () => {
    renderNotice({ terms_version: "1.0" });

    fireEvent.click(screen.getByRole("button", { name: /Read the Terms/ }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/legal/terms"));
  });

  it("offers deletion rather than forcing acceptance", async () => {
    renderNotice({ terms_version: "1.0" });

    fireEvent.click(screen.getByRole("button", { name: /Or delete your account/ }));

    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/settings/delete-account"),
    );
  });
});
