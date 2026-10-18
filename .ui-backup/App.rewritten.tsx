import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { Activity, Film, Sparkles, Loader2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const Home = lazy(() => import("./pages/HomePage"));
const AdStudio = lazy(() => import("./pages/studio/StudioApp"));
const CreateAd = lazy(() => import("./pages/CreateAdPage"));

function Spinner() {
  return (
    <div className="flex items-center justify-center gap-2 text-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>Loading…</span>
    </div>
  );
}

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <BrowserRouter>
      <div className="flex min-h-screen flex-col bg-foreground antialiased">
        <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-2 font-semibold text-foreground"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                <Activity className="h-4 w-4" />
              </div>
              <span className="hidden sm:inline">Vaylo Sports</span>
            </Link>
            <div className="flex items-center gap-1 sm:gap-2">
              <NavLink to="/">Home</NavLink>
              <NavLink to="/studio">Ad Studio</NavLink>
              <NavLink to="/create">Create ad</NavLink>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Film className="h-4 w-4 text-muted" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Flows</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link to="/">Home</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/studio">Ad Studio</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/create">Create ad</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-muted">Sign in</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Activity className="h-5 w-5 text-muted" />
            </Button>
          </div>
        </header>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                  <Activity className="h-4 w-4" />
                </div>
                Vaylo Sports
              </SheetTitle>
              <SheetDescription>Web app and ad workflow.</SheetDescription>
            </SheetHeader>
            <nav className="mt-4 flex flex-col gap-1">
              <Link
                to="/"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted hover:bg-muted/60 hover:text-foreground"
              >
                <Sparkles className="h-4 w-4" />
                Home
              </Link>
              <Link
                to="/studio"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted hover:bg-muted/60 hover:text-foreground"
              >
                <Film className="h-4 w-4" />
                Ad Studio
              </Link>
              <Link
                to="/create"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted hover:bg-muted/60 hover:text-foreground"
              >
                <Film className="h-4 w-4" />
                Create ad
              </Link>
            </nav>
          </SheetContent>
        </Sheet>

        <main className="flex flex-1 flex-col">
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/studio" element={<AdStudio />} />
              <Route path="/create" element={<CreateAd />} />
              <Route
                path="*"
                element={
                  <div className="flex flex-col items-center justify-center gap-3 text-muted">
                    <Film className="h-10 w-10" />
                    <p>This page is part of the ad workflow.</p>
                    <Link to="/">Back to home</Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>

        <footer className="border-t px-6 py-4 text-center text-xs text-muted">
          Vaylo Sports web app — home, ad studio, create ad.
        </footer>
      </div>
    </BrowserRouter>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const internal = typeof window !== "undefined" ? window.location.pathname : "/";
  const isActive = to === "/" ? internal === "/" : internal.startsWith(to);
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-muted/60",
        isActive ? "bg-muted text-foreground" : "text-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
