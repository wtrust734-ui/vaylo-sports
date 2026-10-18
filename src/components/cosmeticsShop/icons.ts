// ============================================================================
// COSMETIC ICON RESOLUTION — one map, shared by the wardrobe grid and the
// FlexCard. The production seed stores lucide NAMES on every cosmetic row, so
// name → component is the only translation needed. An unknown name falls back
// to Sparkles rather than crashing a grid or a share card.
// ============================================================================

import {
  Circle,
  Crown,
  Dog,
  Flame,
  Gift,
  Image as ImageIcon,
  Mountain,
  Sparkle,
  Sparkles,
  Sun,
  Target,
  Trophy,
  Type as TypeIcon,
  Zap,
} from "lucide-react";

const ICON_BY_NAME: Record<string, typeof Circle> = {
  circle: Circle,
  crown: Crown,
  dog: Dog,
  flame: Flame,
  gift: Gift,
  image: ImageIcon,
  mountain: Mountain,
  sparkle: Sparkle,
  sparkles: Sparkles,
  sun: Sun,
  target: Target,
  trophy: Trophy,
  type: TypeIcon,
  zap: Zap,
};

export const resolveIcon = (name: string) => ICON_BY_NAME[name] ?? Sparkles;
