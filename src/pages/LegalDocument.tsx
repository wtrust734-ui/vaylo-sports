import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileQuestion } from "lucide-react";

import { LEGAL_PAGES } from "../../supabase/functions/legal/pages.generated";

// ============================================================================
// LEGAL DOCUMENT VIEWER — the published documents, rendered inside the app
// ----------------------------------------------------------------------------
// Until this screen, every in-app legal link left the app for the marketing
// site: the browser opened, the app went to the background, and a reader lost
// their place — on the very documents the law says must be findable. This
// route puts the pages in the app instead, with no external navigation at all.
//
// Why the content is bundled rather than fetched. The 26 documents are already
// generated into supabase/functions/legal/pages.generated.ts (the same module
// the `legal` edge function serves, pinned to legal/ by legalPages.test.ts).
// Importing that module into a lazy route means the document opens instantly,
// works with no network, and cannot ever describe different content from the
// published site — one source, three consumers. It is ~330 KB of HTML, so the
// route is lazy: the chunk is fetched only when an athlete opens a document,
// never on app start.
//
// Why an iframe. Each document is a complete, self-contained dark-themed HTML
// page with its own <style> block and NO scripts. Injecting that HTML into the
// app's DOM would apply its `body`/`main`/`h1` rules to the whole application;
// an iframe keeps the document's own styling (correct typography, print-ready
// semantics) while the app's shell stays untouched. srcdoc with no sandbox is
// same-origin by construction, which is what lets onLoad measure the document
// and size the frame to it — so there is no second scrollbar inside the frame.
//
// The route is top-level (outside AppLayout) on purpose: the sign-up screen's
// Terms and Privacy links land here too, and requiring a session to read the
// privacy policy would bounce a signed-out reader back to the sign-in wall.
// ============================================================================
const LegalDocument = () => {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const page = LEGAL_PAGES[slug];
  const [height, setHeight] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const loadedRef = useRef(false);

  // A new slug (back → another document) must measure again: the previous
  // height belongs to the previous document and would clip this one.
  useEffect(() => {
    loadedRef.current = false;
    setHeight(null);
    setVisible(false);
  }, [slug]);

  const onLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const doc = e.currentTarget.contentDocument;
    if (!doc?.body) return;
    const measured = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
    setHeight(measured);
    loadedRef.current = true;
    // One frame later, so the fade has a painted frame to animate from.
    requestAnimationFrame(() => setVisible(true));
  };

  if (!page) {
    // A stale or invented slug. Honest fallback rather than a blank frame:
    // say the document does not exist here and offer the library.
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
        <FileQuestion size={40} className="text-muted-foreground" />
        <div>
          <h1 className="text-xl font-bold">Document not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            There is no document at “{slug}” in the published library.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/legal")}
          className="press rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Open the legal library
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#05070f]">
      <header
        className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/[0.08] bg-[#05070f]/95 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "max(0.75rem, var(--vaylo-inset-top))" }}
      >
        <button
          type="button"
          data-page-back
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="press icon-tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={17} aria-hidden />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{page.title}</p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            Published document · Vaylo Sports
          </p>
        </div>
      </header>

      {/*
        Height starts at the viewport so the first painted frame is never a
        collapsed 0-height frame (a flash of background), then snaps to the
        measured document height. The fade-in runs once, on first load — the
        same 240ms curve as every other screen change (index.css .nav-fade).
      */}
      <div className="relative">
        <iframe
          title={page.title}
          srcDoc={page.html}
          onLoad={onLoad}
          className="w-full border-0"
          style={{
            height: height ?? "calc(100dvh - 58px)",
            display: "block",
            opacity: visible ? 1 : 0,
            transition: "opacity 240ms cubic-bezier(0, 0, 0.2, 1)",
          }}
        />
        {!visible && (
          <div className="absolute inset-x-0 top-0 flex h-[calc(100dvh-58px)] items-center justify-center">
            <p className="text-xs text-muted-foreground">Loading document…</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LegalDocument;
