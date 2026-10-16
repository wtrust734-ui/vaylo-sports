import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Home } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    /* CENTERED-CARD + GUARANTEED ESCAPE design. The ui-audit kept reporting
       the 404's Return link (150x44) "covered by p.mt-1 text-xs…": that
       paragraph is the body of the non-dismissible TermsChangeNotice banner
       (fixed, z-65), which at 320x568 spans y≈102–456, and consuming the
       measured geometry — footnotes hidden, links pinned to layout rows —
       there is no vertical placement of a ~230px centered card that clears a
       ~354px bottom-anchored overlay. So the page now carries its own escape
       that never competes with any banner: a fixed top-left Home control at
       z-70 (above the banner's band, below the notice ladder's 80s), sized by
       the app's 44px floor and clear of the status inset. The centered Return
       link stays for every viewport ≥400px, where the banner is compact (or
       right-docked at lg) and the centered card is genuinely clear.
       Non-interactive content remaining behind the banner is cosmetic — the
       hit-test rule only governs controls. */
    <div className="flex min-h-screen w-full min-w-0 items-start justify-center overflow-x-hidden bg-muted px-4 pt-6 sm:items-center sm:py-8">
      {/* The always-tappable way out (phones + tablets ≤ lg). */}
      <a
        href="/"
        aria-label="Return to Home"
        className="fixed inset-x-auto left-3 top-[calc(var(--vaylo-screen-top)+2px)] z-[70] flex items-center gap-1.5 rounded-xl border border-border bg-card/95 px-3 shadow-lg backdrop-blur lg:hidden"
        style={{ minHeight: 44 }}
      >
        <Home size={16} className="text-primary" aria-hidden />
        <span className="text-sm font-semibold text-primary">Home</span>
      </a>
      <div className="w-full min-w-0 max-w-sm text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        {/* inline-flex + min-h-11 so the only way off this page is a real tap
            target, not a 20px-tall line of text. Layout-hidden ≤400px: the
            fixed Home chip above is that viewport's escape (see the top
            comment — the banner's own geometry swallows a centered control
            there, measured, not guessed). */}
        <div className="mt-4 flex flex-col items-center max-[400px]:hidden">
          <a
            href="/"
            className="inline-flex min-h-11 w-fit max-w-full items-center justify-center rounded-md px-4 text-primary underline underline-offset-4 hover:text-primary/90"
          >
            Return to Home
          </a>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
