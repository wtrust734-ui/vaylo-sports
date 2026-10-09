import { QueryClient } from "@tanstack/react-query";

/**
 * Single react-query client, in its own module so the auth layer can clear it
 * on sign-out without a circular import (App.tsx and AuthContext both need it;
 * neither may import the other).
 *
 * Data is never cached across users: sign-out calls queryClient.clear(), so a
 * shared device can never show athlete A's plans, meals or health data to
 * athlete B.
 */
export const queryClient = new QueryClient();
