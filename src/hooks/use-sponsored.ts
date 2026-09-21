import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isAdultDob } from "@/lib/age";

/** The surfaces that can carry a sponsor. Must match the DB whitelist. */
export type SponsoredPlacement = "challenge" | "ai_slot" | "learning" | "post_session";

export interface SponsoredCard {
  placement_id: string;
  brand_name: string;
  brand_slug: string | null;
  brand_logo_url: string | null;
  brand_website: string | null;
  headline: string;
  body: string | null;
  cta_label: string | null;
  cta_url: string | null;
  disclosure_label: string;
}

/**
 * Active sponsors for one surface.
 *
 * Two independent gates, and the second one is the real one:
 *  1. this hook does not even query for an athlete without an adult date of
 *     birth, so a minor's device never asks for sponsored content;
 *  2. `sponsored_placements()` re-derives adult status server-side and returns
 *     an empty set for minors, so bypassing (1) achieves nothing.
 */
export function useSponsoredPlacements(placement: SponsoredPlacement, sport?: string | null) {
  const { profile } = useAuth();
  const dob = profile?.date_of_birth ?? null;
  const isAdult = isAdultDob(dob);
  const [placements, setPlacements] = useState<SponsoredCard[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!isAdult) {
      // Age unknown or under 18: no sponsored content, and no request made.
      setPlacements([]);
      return;
    }

    setLoading(true);
    void (async () => {
      const { data, error } = await supabase.rpc("sponsored_placements" as never, {
        p_placement: placement,
        p_sport: sport ?? null,
      } as never);
      if (cancelled) return;
      if (error) {
        // Never surface sponsor plumbing errors to the athlete.
        setPlacements([]);
      } else {
        setPlacements((data as SponsoredCard[] | null) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdult, placement, sport]);

  /** Impression/click counting. Silently ignored for minors and on failure. */
  const record = useCallback(
    (placementId: string, kind: "impression" | "click") => {
      if (!isAdult || !placementId) return;
      void supabase
        .rpc("record_brand_event" as never, { p_placement_id: placementId, p_kind: kind } as never)
        .then(
          () => undefined,
          () => undefined
        );
    },
    [isAdult]
  );

  return { placements, loading, record, isAdult };
}
