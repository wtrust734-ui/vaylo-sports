// ============================================================================
// Re-export, deliberately not a copy.
// ----------------------------------------------------------------------------
// This directory keeps its own copies of a few shared modules (planSchema.ts,
// userTables.ts, aiModels.ts) because of how that function was originally
// bundled. The athlete dossier is no longer one of them.
//
// It was a 150-line copy of supabase/functions/_shared/athleteDossier.ts, and
// copying is exactly how a memory drifts: the client path and this one would
// slowly describe different athletes, which is the failure the whole dossier
// exists to prevent. Nothing in this function imported the copy when it was
// removed, so the copy is gone and this file forwards to the canonical module
// instead. If a future deployment ever needs a physical copy, it must be
// generated from the canonical file rather than hand-edited, and the section
// order in it must stay identical to src/lib/athleteMemory.ts.
// ============================================================================

export * from "../../_shared/athleteDossier.ts";
