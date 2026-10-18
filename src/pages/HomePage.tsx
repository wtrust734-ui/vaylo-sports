import { Link } from "react-router-dom";
import { Film, Sparkles, Play, ChevronRight, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-12 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
            <Film className="h-10 w-10" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Vaylo Sports Ads Studio
          </h1>
          <p className="max-w-lg text-balance text-muted">
            Describe the ad you want, watch the workflow build it, then approve and
            download the finished creative.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="border-transparent hover:border-muted transition-all">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted">
                <Sparkles className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">Start a campaign</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted">
              Open the chat, pick a format, select a planned ad, and let the Brain
              plan and build the creative.
            </CardContent>
            <div className="flex items-center justify-between border-t px-4 py-3">
              <Link to="/create">
                <Button className="w-full font-medium">
                  Open chat
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <span className="text-xs text-muted">/create</span>
            </div>
          </Card>

          <Card className="border-transparent hover:border-muted transition-all">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted">
                <Film className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">Ad Studio</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted">
              Watch the workflow execute, inspect each stage, and review the final
              creative.
            </CardContent>
            <div className="flex items-center justify-between border-t px-4 py-3">
              <Link to="/studio">
                <Button variant="outline" className="w-full font-medium">
                  Open studio
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <span className="text-xs text-muted">/studio</span>
            </div>
          </Card>

          <Card className="border-transparent hover:border-muted transition-all">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted">
                <Play className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">Approved ads</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted">
              Review previous versions, approve new creative and download the actual
              asset.
            </CardContent>
            <div className="flex items-center justify-between border-t px-4 py-3">
              <Link to="/studio">
                <Button variant="outline" className="w-full font-medium">
                  Open studio
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <span className="text-xs text-muted">/studio</span>
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4" />
            Home
          </span>
          <span className="text-muted">/</span>
          <span className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4" />
            Ad Studio
          </span>
          <span className="text-muted">/</span>
          <span className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4" />
            Create ad
          </span>
        </div>
      </div>

      <footer className="border-t px-6 py-4 text-center text-xs text-muted">
        Vaylo Sports web app — describe an ad, watch it build, approve and download
        the result.
      </footer>
    </div>
  );
}
