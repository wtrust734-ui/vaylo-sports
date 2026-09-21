import { motion } from "framer-motion";
import { getItem } from "@/lib/avatarCatalog";
import { cn } from "@/lib/utils";

export interface AvatarLoadout {
  body?: string | null;
  skin_tone?: string | null;
  face_shape?: string | null;
  hair?: string | null;
  hair_color?: string | null;
  eye_color?: string | null;
  brows?: string | null;
  facial_hair?: string | null;
  outfit?: string | null;
  pants?: string | null;
  shoes?: string | null;
  headgear?: string | null;
  accessory?: string | null;
  gloves?: string | null;
  badge?: string | null;
  background?: string | null;
  pose?: string | null;
  display_name?: string | null;
  prestige_level?: number | null;
}

interface Props {
  loadout: AvatarLoadout;
  size?: number;
  className?: string;
  showName?: boolean;
  animated?: boolean;
}

/**
 * Full head-to-toe character preview composed in SVG. Every catalog option
 * meaningfully changes the silhouette (hair shape, beard, outfit, pants,
 * shoes, headgear, gloves, accessories).
 */
const AvatarPreview = ({ loadout, size = 240, className, showName = false, animated = true }: Props) => {
  const skin = getItem(loadout.skin_tone)?.color ?? "#cf9670";
  const body = getItem(loadout.body);
  const hairItem = getItem(loadout.hair);
  const hairColor = getItem(loadout.hair_color)?.color ?? "#1f2937";
  const eyeColor = getItem(loadout.eye_color)?.color ?? "#0f172a";
  const brows = getItem(loadout.brows);
  const beard = getItem(loadout.facial_hair);
  const outfit = getItem(loadout.outfit)?.color ?? "#3b82f6";
  const pants = getItem(loadout.pants)?.color ?? "#0a0a0a";
  const shoes = getItem(loadout.shoes)?.color ?? "#f4f4f5";
  const head = getItem(loadout.headgear);
  const acc = getItem(loadout.accessory);
  const gloves = getItem(loadout.gloves);
  const badge = getItem(loadout.badge);
  const bg = getItem(loadout.background)?.color ?? "#0f172a";
  const pose = getItem(loadout.pose);
  const face = getItem(loadout.face_shape);

  const poseRotate = pose?.id === "pose_flex" ? -3 : 0;
  const armsUp = pose?.id === "pose_victory" || pose?.id === "pose_ascend";

  // Body scale modifiers
  const bodyShoulder = body?.id === "body_powerful" ? 1.12 : body?.id === "body_lean" ? 0.92 : body?.id === "body_tall" ? 0.98 : 1;
  const bodyHeight   = body?.id === "body_tall" ? 1.05 : 1;

  // Face proportions
  const faceRy = face?.id === "face_round" ? 30 : face?.id === "face_square" ? 26 : face?.id === "face_diamond" ? 30 : face?.id === "face_heart" ? 27 : 28;
  const faceRx = face?.id === "face_square" ? 26 : face?.id === "face_round" ? 28 : face?.id === "face_diamond" ? 22 : 25;

  // hair color override: bald = transparent
  const hairFill = hairItem?.id === "hair_bald" ? "transparent" : hairColor;

  const renderHair = () => {
    if (!hairItem || hairItem.id === "hair_bald") return null;
    switch (hairItem.id) {
      case "hair_buzz":
        return <path d="M72 80 Q100 64 128 80 L128 88 L72 88 Z" fill={hairFill} opacity={0.85} />;
      case "hair_short":
        return <path d="M70 84 Q100 56 130 84 L130 96 Q120 88 100 88 Q80 88 70 96 Z" fill={hairFill} />;
      case "hair_messy":
        return <path d="M68 84 Q78 50 92 70 Q100 48 110 72 Q124 52 132 86 L130 96 Q115 86 100 90 Q85 88 70 96 Z" fill={hairFill} />;
      case "hair_curly":
        return (
          <g fill={hairFill}>
            <circle cx="80" cy="78" r="9" /><circle cx="92" cy="70" r="9" /><circle cx="104" cy="68" r="9" />
            <circle cx="116" cy="72" r="9" /><circle cx="124" cy="82" r="9" /><circle cx="74" cy="88" r="8" /><circle cx="128" cy="90" r="8" />
          </g>
        );
      case "hair_wavy":
        return <path d="M68 86 Q74 60 88 74 Q98 58 108 74 Q122 60 132 86 L130 98 Q115 92 100 94 Q85 92 70 98 Z" fill={hairFill} />;
      case "hair_long":
        return <path d="M66 130 Q60 84 80 70 Q100 50 120 70 Q140 84 134 130 L128 130 Q132 96 124 88 Q118 92 110 92 L90 92 Q82 92 76 88 Q68 96 72 130 Z" fill={hairFill} />;
      case "hair_ponytail":
        return (
          <g fill={hairFill}>
            <path d="M70 84 Q100 58 130 84 L130 96 Q120 88 100 88 Q80 88 70 96 Z" />
            <path d="M128 92 Q150 108 142 140 L134 138 Q138 116 124 100 Z" />
          </g>
        );
      case "hair_bun":
        return (
          <g fill={hairFill}>
            <path d="M72 86 Q100 64 128 86 L128 94 Q115 88 100 88 Q85 88 72 94 Z" />
            <circle cx="100" cy="56" r="12" />
          </g>
        );
      case "hair_afro":
        return <ellipse cx="100" cy="74" rx="44" ry="32" fill={hairFill} />;
      case "hair_dreads":
        return (
          <g fill={hairFill}>
            <path d="M70 84 Q100 56 130 84 L130 92 L70 92 Z" />
            {[72,84,96,108,120].map((x,i)=><rect key={i} x={x} y="90" width="6" height="30" rx="3" />)}
          </g>
        );
      case "hair_braids":
        return (
          <g fill={hairFill}>
            <path d="M70 84 Q100 60 130 84 L130 94 L70 94 Z" />
            <path d="M74 94 Q72 110 78 124" stroke={hairFill} strokeWidth="6" strokeLinecap="round" fill="none" />
            <path d="M126 94 Q128 110 122 124" stroke={hairFill} strokeWidth="6" strokeLinecap="round" fill="none" />
          </g>
        );
      case "hair_mohawk":
        return <path d="M92 50 Q100 38 108 50 L108 90 L92 90 Z" fill={hairFill} />;
      case "hair_fade":
        return <path d="M72 84 Q100 60 128 84 L128 90 L120 92 L80 92 L72 90 Z" fill={hairFill} />;
      default:
        return <path d="M70 84 Q100 60 130 84 L130 92 L70 92 Z" fill={hairFill} />;
    }
  };

  const renderBeard = () => {
    if (!beard || beard.id === "fh_clean") return null;
    const c = hairColor;
    switch (beard.id) {
      case "fh_stubble":
        return <path d="M78 108 Q100 124 122 108 Q124 116 100 122 Q76 116 78 108 Z" fill={c} opacity={0.45} />;
      case "fh_goatee":
        return <path d="M94 110 Q100 124 106 110 L106 122 Q100 128 94 122 Z" fill={c} />;
      case "fh_mustache":
        return <path d="M88 102 Q100 108 112 102 Q108 106 100 106 Q92 106 88 102 Z" fill={c} />;
      case "fh_full":
        return <path d="M76 100 Q80 124 100 126 Q120 124 124 100 Q120 116 100 118 Q80 116 76 100 Z" fill={c} />;
    }
  };

  return (
    <div
      className={cn("relative rounded-3xl overflow-hidden border border-white/5", className)}
      style={{ width: size, height: size, background: `radial-gradient(circle at 50% 35%, ${bg}, #050810 80%)` }}
    >
      {/* Aura */}
      {acc?.id === "acc_aura" && (
        <motion.div className="absolute inset-2 rounded-full blur-2xl"
          style={{ background: acc.color, opacity: 0.4 }}
          animate={animated ? { scale: [1, 1.1, 1], opacity: [0.25, 0.55, 0.25] } : {}}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} />
      )}
      {acc?.id === "acc_lightning" && (
        <motion.div className="absolute inset-0 pointer-events-none mix-blend-screen"
          style={{ background: `radial-gradient(circle at 50% 30%, ${acc.color}66, transparent 60%)` }}
          animate={animated ? { opacity: [0.4, 0.9, 0.4] } : {}}
          transition={{ duration: 1.4, repeat: Infinity }} />
      )}
      {acc?.id === "acc_wings" && (
        <motion.div className="absolute inset-x-0 top-[35%] text-center text-6xl select-none"
          style={{ filter: `drop-shadow(0 0 14px ${acc.color})` }}
          animate={animated ? { y: [0, -3, 0] } : {}}
          transition={{ duration: 2.4, repeat: Infinity }}>🪽</motion.div>
      )}

      <motion.div
        className="absolute inset-0 flex items-end justify-center"
        animate={animated ? { y: [0, -2, 0] } : {}}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{ transform: `rotate(${poseRotate}deg)` }}
      >
        <svg viewBox="0 0 200 240" width={size} height={size} className="overflow-visible">
          {/* Ground shadow */}
          <ellipse cx="100" cy="232" rx="48" ry="5" fill="#000" opacity="0.5" />

          {/* Legs / Pants */}
          <g transform={`translate(0, ${bodyHeight > 1 ? 4 : 0})`}>
            <path d={`M${100 - 18 * bodyShoulder} 196 L${100 - 16} 224 L${100 - 6} 224 L${100 - 4} 196 Z`} fill={pants} />
            <path d={`M${100 + 18 * bodyShoulder} 196 L${100 + 16} 224 L${100 + 6} 224 L${100 + 4} 196 Z`} fill={pants} />
            {/* Shoes */}
            <ellipse cx={100 - 11} cy={228} rx="9" ry="4" fill={shoes} />
            <ellipse cx={100 + 11} cy={228} rx="9" ry="4" fill={shoes} />
          </g>

          {/* Torso (outfit) */}
          <path
            d={`M${100 - 38 * bodyShoulder} 200 Q${100 - 38 * bodyShoulder} 140 100 138 Q${100 + 38 * bodyShoulder} 140 ${100 + 38 * bodyShoulder} 200 Z`}
            fill={outfit}
          />

          {/* Arms */}
          {armsUp ? (
            <>
              <path d="M68 158 Q52 110 78 78" stroke={skin} strokeWidth="14" strokeLinecap="round" fill="none" />
              <path d="M132 158 Q148 110 122 78" stroke={skin} strokeWidth="14" strokeLinecap="round" fill="none" />
              {gloves && gloves.id !== "gloves_none" && (<><circle cx="78" cy="78" r="10" fill={gloves.color} /><circle cx="122" cy="78" r="10" fill={gloves.color} /></>)}
            </>
          ) : pose?.id === "pose_flex" ? (
            <>
              <path d="M60 168 Q42 132 60 108 Q78 100 84 130" stroke={skin} strokeWidth="14" strokeLinecap="round" fill={skin} />
              <path d="M140 168 Q158 132 140 108 Q122 100 116 130" stroke={skin} strokeWidth="14" strokeLinecap="round" fill={skin} />
              {gloves && gloves.id !== "gloves_none" && (<><circle cx="80" cy="124" r="10" fill={gloves.color} /><circle cx="120" cy="124" r="10" fill={gloves.color} /></>)}
            </>
          ) : (
            <>
              <path d={`M${100 - 38 * bodyShoulder} 162 Q${100 - 46 * bodyShoulder} 188 ${100 - 36 * bodyShoulder} 200`}
                    stroke={skin} strokeWidth="13" strokeLinecap="round" fill="none" />
              <path d={`M${100 + 38 * bodyShoulder} 162 Q${100 + 46 * bodyShoulder} 188 ${100 + 36 * bodyShoulder} 200`}
                    stroke={skin} strokeWidth="13" strokeLinecap="round" fill="none" />
              {gloves && gloves.id !== "gloves_none" && (
                <><circle cx={100 - 36 * bodyShoulder} cy="200" r="9" fill={gloves.color} />
                  <circle cx={100 + 36 * bodyShoulder} cy="200" r="9" fill={gloves.color} /></>
              )}
            </>
          )}

          {/* Neck */}
          <rect x="92" y="120" width="16" height="22" fill={skin} />

          {/* Head — face shape */}
          <ellipse cx="100" cy="92" rx={faceRx} ry={faceRy} fill={skin} />

          {/* Hair (behind front face but on top of head) */}
          <g>{renderHair()}</g>

          {/* Brows */}
          {brows && (
            brows.id === "brow_arched" ? (
              <>
                <path d="M84 88 Q90 84 96 88" stroke={hairColor} strokeWidth="2.5" fill="none" strokeLinecap="round" />
                <path d="M104 88 Q110 84 116 88" stroke={hairColor} strokeWidth="2.5" fill="none" strokeLinecap="round" />
              </>
            ) : brows.id === "brow_thick" ? (
              <>
                <rect x="84" y="86" width="14" height="3.5" rx="1.5" fill={hairColor} />
                <rect x="102" y="86" width="14" height="3.5" rx="1.5" fill={hairColor} />
              </>
            ) : brows.id === "brow_thin" ? (
              <>
                <rect x="86" y="88" width="12" height="1.5" rx="1" fill={hairColor} />
                <rect x="102" y="88" width="12" height="1.5" rx="1" fill={hairColor} />
              </>
            ) : (
              <>
                <rect x="85" y="87" width="13" height="2.5" rx="1.2" fill={hairColor} />
                <rect x="102" y="87" width="13" height="2.5" rx="1.2" fill={hairColor} />
              </>
            )
          )}

          {/* Eyes */}
          <g>
            <ellipse cx="91" cy="95" rx="3.4" ry="3" fill="#fff" />
            <ellipse cx="109" cy="95" rx="3.4" ry="3" fill="#fff" />
            <circle cx="91" cy="95" r="2.2" fill={eyeColor} />
            <circle cx="109" cy="95" r="2.2" fill={eyeColor} />
            <circle cx="91.6" cy="94.4" r="0.7" fill="#fff" />
            <circle cx="109.6" cy="94.4" r="0.7" fill="#fff" />
          </g>

          {/* Nose + mouth subtle */}
          <path d="M100 100 L98 106 L102 106 Z" fill="#000" opacity="0.12" />
          <path d="M94 112 Q100 116 106 112" stroke="#000" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.45" />

          {/* Beard / facial hair */}
          {renderBeard()}

          {/* Headgear */}
          {head?.id === "head_band" && <rect x="72" y="84" width="56" height="6" fill={head.color} />}
          {head?.id === "head_cap_blk" || head?.id === "head_cap_wht" ? (
            <>
              <path d="M70 78 Q100 56 130 78 L130 88 L70 88 Z" fill={head.color} />
              <path d="M70 86 L150 86 L150 92 L70 92 Z" fill={head.color} />
            </>
          ) : null}
          {head?.id === "head_beanie" && <path d="M68 86 Q68 52 100 50 Q132 52 132 86 Z" fill={head.color} />}
          {head?.id === "head_visor" && <path d="M62 86 Q100 66 138 86 L138 94 L62 94 Z" fill={head.color} opacity="0.9" />}
          {head?.id === "head_helmet" && <path d="M66 92 Q100 48 134 92 L134 100 L66 100 Z" fill={head.color} />}
          {head?.id === "head_crown" && (
            <path d="M72 76 L84 56 L94 76 L106 54 L116 76 L128 56 L132 82 L68 82 Z" fill={head.color} stroke="#92400e" strokeWidth="1" />
          )}
          {head?.id === "head_halo" && (
            <ellipse cx="100" cy="58" rx="36" ry="6" fill="none" stroke={head.color} strokeWidth="3" style={{ filter: `drop-shadow(0 0 8px ${head.color})` }} />
          )}
          {head?.id === "head_horns" && (
            <g fill={head.color}>
              <path d="M76 76 Q66 60 80 50 Q82 64 86 76 Z" />
              <path d="M124 76 Q134 60 120 50 Q118 64 114 76 Z" />
            </g>
          )}

          {/* Glasses */}
          {acc?.id === "acc_glasses" && (
            <g stroke="#0a0a0a" strokeWidth="2" fill="none">
              <circle cx="91" cy="96" r="6" fill={acc.color} opacity="0.45" />
              <circle cx="109" cy="96" r="6" fill={acc.color} opacity="0.45" />
              <line x1="97" y1="96" x2="103" y2="96" />
            </g>
          )}

          {/* Chain */}
          {acc?.id === "acc_chain" && (
            <path d="M84 138 Q100 154 116 138" stroke={acc.color} strokeWidth="3" fill="none" />
          )}
        </svg>
      </motion.div>

      {/* Badge */}
      {badge && badge.id !== "badge_none" && (
        <motion.div
          className="absolute top-2 right-2 text-2xl drop-shadow-[0_0_6px_rgba(0,0,0,0.6)]"
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.2 }}
          title={badge.name}
        >
          {badge.glyph || "⭐"}
        </motion.div>
      )}

      {showName && loadout.display_name && (
        <div className="absolute bottom-2 inset-x-0 text-center">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-black/55 backdrop-blur text-foreground">
            {loadout.display_name}
            {loadout.prestige_level ? <span className="ml-1 text-energy">★{loadout.prestige_level}</span> : null}
          </span>
        </div>
      )}
    </div>
  );
};

export default AvatarPreview;
