// This file runs in two places: the Deno ad pipeline (which has `Deno`) and
// tooling on Node (which does not). Both references are optional-chained, so
// the globals are read defensively instead of imported — and off globalThis so
// the browser build never references an undeclared name.
const asRuntime = globalThis as { Deno?: { readTextFileSync?: (p: string) => string } };
const Deno = asRuntime.Deno;

/** Path join without importing node's fs/path — this file stays runtime-free. */
const joinPath = (a: string, b: string): string =>
  a.endsWith("/") || b.startsWith("/") ? `${a}${b}` : `${a}/${b}`;

export interface PlanItem {
  id: string;
  sequence: number;
  name: string;
  format: "image" | "video" | "both";
  objective: string;
  targetAudience: string;
  coreMessage: string;
  hook: string;
  productFeature: string;
  callToAction: string;
  platform?: string;
  aspectRatio?: string;
  status: "planned" | "in_progress" | "completed" | "approved";
}

export const DEFAULT_PLAN_ITEMS: PlanItem[] = [
  {
    id: "plan-1",
    sequence: 1,
    name: "First video ad — app intro",
    format: "video",
    objective: "Introduce Vaylo Sports as an all-sports training log with AI coaching.",
    targetAudience: "Athletes aged 18 and over who train across multiple sports.",
    coreMessage: "One training log that understands your sport, your load and your next step.",
    hook: "What if your training log actually knew your sport?",
    productFeature: "All-sports training log with AI coaching and workout analysis.",
    callToAction: "Start logging from today.",
    platform: "short-form video",
    aspectRatio: "9:16",
    status: "planned",
  },
  {
    id: "plan-2",
    sequence: 2,
    name: "Second picture ad — training plans",
    format: "image",
    objective: "Show Vaylo Sports personalized training plans for real athletes.",
    targetAudience: "Adult athletes who want a plan built around their sport and schedule.",
    coreMessage: "Training plans that fit your sport and your week.",
    hook: "A plan that fits your life, not the other way around.",
    productFeature: "Personalized week-by-week training plans.",
    callToAction: "Build your plan.",
    platform: "image ad",
    aspectRatio: "1:1",
    status: "planned",
  },
  {
    id: "plan-3",
    sequence: 3,
    name: "Both formats — feature highlight",
    format: "both",
    objective: "Highlight a single Vaylo Sports feature across image and video.",
    targetAudience: "Developing and competitive adult athletes.",
    coreMessage: "Understand your limiter and work on the right thing.",
    hook: "Find the one thing holding you back.",
    productFeature: "Limiter analysis and targeted training adjustments.",
    callToAction: "Take the limiter test.",
    platform: "short-form video and image",
    aspectRatio: "9:16",
    status: "planned",
  },
];

export function loadPlanItems(): PlanItem[] {
  try {
    const raw = process.env.VAYLO_AD_PLAN_PATH;
    if (raw) {
      const text = Deno?.readTextFileSync?.(raw);
      if (text) {
        const parsed = JSON.parse(text) as PlanItem[];
        if (Array.isArray(parsed) && parsed.length) {
          return parsed;
        }
      }
    }
  } catch {
    console.warn("[plan] could not load custom advertising plan, using default items");
  }

  try {
    const raw = process.env.HOME || process.env.USERPROFILE;
    if (raw) {
      const candidate = joinPath(raw, "vaylo-ad-plan.json");
      const text = Deno?.readTextFileSync?.(candidate);
      if (text) {
        const parsed = JSON.parse(text) as PlanItem[];
        if (Array.isArray(parsed) && parsed.length) {
          return parsed;
        }
      }
    }
  } catch {
    console.warn("[plan] could not load advertising plan from home directory");
  }

  return DEFAULT_PLAN_ITEMS;
}

export function nextUncompletedItem(items: PlanItem[]): PlanItem | null {
  return items.find((item) => item.status === "planned" || item.status === "in_progress") ?? null;
}

export function itemById(items: PlanItem[], id: string): PlanItem | undefined {
  return items.find((item) => item.id === id);
}
