import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // PKCE, not the implicit flow.
    //
    // The implicit flow returns the tokens themselves in the redirect, and the
    // app's callback is a custom scheme (com.vaylosports.app://) that Android
    // does not verify — any other app on the device can register the same
    // scheme and receive what the redirect carries. PKCE makes the redirect
    // carry a single-use code that is useless without the verifier, which
    // supabase-js keeps in this client's storage, so an intercepted code buys the
    // interceptor nothing.
    //
    // Verified rather than assumed: with this unset, the /authorize URL has no
    // code_challenge parameter at all. nativeOAuth.ts was already written for
    // PKCE — it parses `code` and `flow_state_id` and calls
    // exchangeCodeForSession — so the exchange side needed no change, only the
    // request side asking for a code in the first place.
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    // Unlocks supabase.auth.signInWithPasskey() / registerPasskey(). The server
    // side is gated by the project's "passkeys_enabled" auth setting; the
    // client flag merely makes the API surface callable.
    experimental: { passkey: true },
  }
});
