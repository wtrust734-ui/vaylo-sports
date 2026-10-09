// ============================================================================
// Minimal ambient types for the Deno edge runtime
// ----------------------------------------------------------------------------
// Lets `npm run typecheck:functions` check `supabase/functions` on a machine with
// no Deno installed. Nothing here ships or runs — it exists only so `tsc` can
// resolve the two things the functions genuinely need from Deno.
//
// Only this surface is declared, because only this surface is used (verified by
// grepping the functions folder): `Deno.env.get`, `Deno.serve`, the socket calls
// `_shared/email.ts` needs to reach smtp.gmail.com, and the one remote module
// with no local equivalent.
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

  /**
   * The socket surface `_shared/email.ts` uses.
   *
   * Deliberately the shape that file relies on and nothing more — it talks to
   * smtp.gmail.com on port 465 and wraps the socket with TLS, so it needs
   * connect, startTls and the read/write/close trio. Declaring the full Deno
   * net API here would be inventing surface nothing exercises, and the whole
   * point of this file is that it only describes what is actually used.
   */
  interface Conn {
    read(buffer: Uint8Array): Promise<number | null>;
    write(data: Uint8Array): Promise<number>;
    close(): void;
  }

  interface TcpConn extends Conn {
    readonly remoteAddr: { hostname: string; port: number };
    readonly localAddr: { hostname: string; port: number };
  }

  /**
   * A TLS socket has exactly the same surface as a TCP one once wrapped, so
   * this is an alias rather than an empty interface. An empty `extends` is
   * flagged by lint as equivalent to its supertype, which is true and is the
   * point — it just has to be expressed as an alias.
   */
  type TlsConn = Conn;

  function connect(options: { hostname: string; port: number }): Promise<TcpConn>;

  function startTls(
    conn: TcpConn,
    options?: { hostname?: string; caCerts?: string[] },
  ): Promise<TlsConn>;
}

/** deno.land's HTTP server module — only `serve` is imported from it. */
declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}
