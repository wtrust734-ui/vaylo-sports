// ============================================================================
// Minimal ambient types for the Deno edge runtime
// ----------------------------------------------------------------------------
// Lets `npm run typecheck:functions` check `supabase/functions` on a machine with
// no Deno installed. Nothing here ships or runs — it exists only so `tsc` can
// resolve the two things the functions genuinely need from Deno.
//
// Only this surface is declared, because only this surface is used (verified by
// grepping the functions folder): `Deno.env.get`, `Deno.serve`, and the one
// remote module with no local equivalent.
//
// The Supabase client is deliberately NOT stubbed here. tsconfig.functions.json
// maps the `https://esm.sh/@supabase/supabase-js*` specifiers to the installed
// package, so `.from()`, `.rpc()` and `.auth` are checked against real types
// rather than collapsing to `any`.
//
// Scope of what this catches: undefined identifiers, unresolved local imports,
// renamed/missing exports between files, and syntax errors — i.e. the class of
// bug that took checkout down (`moneyCatalog.ts` referenced a const that had been
// renamed, which threw at module evaluation and killed the worker on boot).
// For complete Deno type checking, run `deno check` where Deno is available.
// ============================================================================

declare namespace Deno {
  const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    has(key: string): boolean;
    toObject(): Record<string, string>;
  };

  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}

/** deno.land's HTTP server module — only `serve` is imported from it. */
declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}
