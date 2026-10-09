import { supabase } from "@/integrations/supabase/client";
import type { Json, TablesInsert } from "@/integrations/supabase/types";

/** Conditional writes preserve edits made while an AI request was in flight. */
export async function saveAiPlanEdit(userId: string, planId: string, baseline: Json, result: Json): Promise<void> {
  const { data, error } = await supabase.from("training_plans").update({ plan_data: result })
    .eq("user_id", userId).eq("id", planId).eq("plan_data", JSON.stringify(baseline)).select("id").maybeSingle();
  if (error) throw error;
  if (data) return;
  // A previous save may have committed before its response was lost.
  const replay = await supabase.from("training_plans").select("id")
    .eq("user_id", userId).eq("id", planId).eq("plan_data", JSON.stringify(result)).maybeSingle();
  if (replay.error) throw replay.error;
  if (!replay.data) throw new Error("Your plan changed while this edit was being prepared. The AI result is saved on this device; resolve the conflict before applying it.");
}

/** The intent UUID is also the row ID, so a lost insert response cannot create another plan. */
export async function saveAiNutritionPlan(row: TablesInsert<"nutrition_plans"> & { id: string; user_id: string }): Promise<void> {
  const { error } = await supabase.from("nutrition_plans").insert(row);
  if (!error) return;
  if (error.code !== "23505") throw error;
  const existing = await supabase.from("nutrition_plans").select("id").eq("id", row.id).eq("user_id", row.user_id).single();
  if (existing.error || !existing.data) throw new Error("Could not confirm the saved nutrition plan. Retry to check its status.");
}
