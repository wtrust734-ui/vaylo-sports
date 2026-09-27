// Minimal declarations so `tsc --noEmit -p tsconfig.functions.json` can resolve
// the Deno `npm:` specifier imports used by supabase/functions/og-image/handler.tsx.
// Deno resolves these at deploy time; tsc only needs the module to exist.
declare module "npm:@vercel/og@^0" {
  export class ImageResponse {
    constructor(element: unknown, options?: {
      width?: number;
      height?: number;
      debug?: boolean;
      [key: string]: unknown;
    });
  }
}

declare module "npm:react@^19" {
  const React: Record<string, unknown>;
  export default React;
  export namespace JSX {
    interface IntrinsicElements {
      [elem: string]: Record<string, unknown>;
    }
  }
}
