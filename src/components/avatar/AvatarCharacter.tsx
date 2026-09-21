import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { getItem } from "@/lib/avatarCatalog";
import { cn } from "@/lib/utils";

export interface AvatarLoadout {
  body?: string | null;
  skin_tone?: string | null;
  face_shape?: string | null;
  expression?: string | null;
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
  rotationY?: number; // -60..60 (fake 3D horizontal)
  zoom?: number;
  animated?: boolean;
  showBadge?: boolean;
  className?: string;
}

/**
 * Full-body, polished cartoon athlete. Idle animations: breathing, blinking,
 * subtle sway and hair drift. Supports fake-3D rotation and zoom.
 */
export default function AvatarCharacter({
  loadout, size = 320, rotationY = 0, zoom = 1, animated = true, showBadge = true, className,
}: Props) {
  const skin = getItem(loadout.skin_tone)?.color ?? "#cf9670";
  const body = getItem(loadout.body);
  const hairItem = getItem(loadout.hair);
  const hairColor = getItem(loadout.hair_color)?.color ?? "#1f2937";
  const eyeColor = getItem(loadout.eye_color)?.color ?? "#0f172a";
  const brows = getItem(loadout.brows);
  const beard = getItem(loadout.facial_hair);
  const expr = getItem(loadout.expression);
  const outfit = getItem(loadout.outfit)?.color ?? "#3b82f6";
  const pants = getItem(loadout.pants)?.color ?? "#0a0a0a";
  const shoes = getItem(loadout.shoes)?.color ?? "#f4f4f5";
  const shoesId = loadout.shoes ?? "";
  const head = getItem(loadout.headgear);
  const acc = getItem(loadout.accessory);
  const gloves = getItem(loadout.gloves);
  const badge = getItem(loadout.badge);
  const face = getItem(loadout.face_shape);
  const pose = getItem(loadout.pose);

  // Physique scale factors — genuinely alter silhouette.
  const P = useMemo(() => {
    const map: Record<string, { shoulder: number; chest: number; waist: number; arm: number; thigh: number; height: number; neck: number }> = {
      body_athletic:   { shoulder: 1.00, chest: 1.00, waist: 0.85, arm: 1.00, thigh: 1.00, height: 1.00, neck: 1.00 },
      body_lean:       { shoulder: 0.88, chest: 0.90, waist: 0.72, arm: 0.85, thigh: 0.88, height: 1.00, neck: 0.95 },
      body_powerful:   { shoulder: 1.15, chest: 1.15, waist: 0.95, arm: 1.15, thigh: 1.10, height: 0.98, neck: 1.10 },
      body_tall:       { shoulder: 0.98, chest: 0.95, waist: 0.85, arm: 1.05, thigh: 1.05, height: 1.08, neck: 1.05 },
      body_short:      { shoulder: 1.02, chest: 1.00, waist: 0.90, arm: 0.92, thigh: 0.92, height: 0.92, neck: 0.95 },
      body_distance:   { shoulder: 0.90, chest: 0.88, waist: 0.75, arm: 0.85, thigh: 0.90, height: 1.03, neck: 0.95 },
      body_sprinter:   { shoulder: 1.10, chest: 1.08, waist: 0.85, arm: 1.10, thigh: 1.18, height: 1.00, neck: 1.05 },
      body_footballer: { shoulder: 1.05, chest: 1.05, waist: 0.85, arm: 1.05, thigh: 1.12, height: 1.00, neck: 1.02 },
      body_basketball: { shoulder: 1.02, chest: 1.00, waist: 0.82, arm: 1.15, thigh: 1.10, height: 1.10, neck: 1.05 },
      body_cyclist:    { shoulder: 0.92, chest: 0.92, waist: 0.78, arm: 0.90, thigh: 1.20, height: 1.00, neck: 0.95 },
      body_swimmer:    { shoulder: 1.20, chest: 1.10, waist: 0.80, arm: 1.10, thigh: 1.00, height: 1.05, neck: 1.05 },
      body_gymnast:    { shoulder: 1.15, chest: 1.10, waist: 0.78, arm: 1.10, thigh: 1.05, height: 0.94, neck: 1.05 },
      body_builder:    { shoulder: 1.28, chest: 1.25, waist: 0.95, arm: 1.30, thigh: 1.20, height: 1.02, neck: 1.20 },
    };
    return map[body?.id ?? "body_athletic"] ?? map.body_athletic;
  }, [body?.id]);

  const faceRy = face?.id === "face_round" ? 34 : face?.id === "face_square" ? 30 : face?.id === "face_diamond" ? 34 : face?.id === "face_heart" ? 31 : 32;
  const faceRx = face?.id === "face_square" ? 29 : face?.id === "face_round" ? 32 : face?.id === "face_diamond" ? 25 : 28;

  const armsUp = pose?.id === "pose_victory" || pose?.id === "pose_ascend" || pose?.id === "pose_champion" || pose?.id === "pose_olympic" || pose?.id === "pose_fist";
  const flexing = pose?.id === "pose_flex";
  const dancing = pose?.id === "pose_dance";
  const running = pose?.id === "pose_sprint" || pose?.id === "pose_jog" || pose?.id === "pose_walk" || pose?.id === "pose_power" || pose?.id === "pose_champ_walk";

  // Blink cycle
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!animated) return;
    let cancelled = false;
    const loop = () => {
      const delay = 2500 + Math.random() * 2800;
      setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        setTimeout(() => { if (!cancelled) setBlink(false); loop(); }, 140);
      }, delay);
    };
    loop();
    return () => { cancelled = true; };
  }, [animated]);

  // ------- Hair (front & back layers) -------
  const hairFill = hairItem?.id === "hair_bald" ? "transparent" : hairColor;
  const renderHair = () => {
    if (!hairItem || hairItem.id === "hair_bald") return null;
    const id = hairItem.id;
    // Front hair caps positioned around head at (100, 80) rx=faceRx, ry=faceRy
    switch (id) {
      case "hair_buzz":     return <path d="M72 68 Q100 50 128 68 L128 82 L72 82 Z" fill={hairFill} opacity={0.9} />;
      case "hair_crew":     return <path d="M70 70 Q100 46 130 70 L130 84 Q120 78 100 78 Q80 78 70 84 Z" fill={hairFill} />;
      case "hair_short":    return <path d="M68 72 Q100 40 132 72 L132 86 Q120 78 100 78 Q80 78 68 86 Z" fill={hairFill} />;
      case "hair_messy":    return <path d="M66 74 Q76 38 92 60 Q100 34 110 62 Q126 40 134 76 L132 88 Q116 78 100 82 Q84 80 68 88 Z" fill={hairFill} />;
      case "hair_curly":    return (
        <g fill={hairFill}>
          {[[78,66],[92,56],[106,54],[120,58],[126,72],[72,80],[130,82]].map(([x,y],i)=>(<circle key={i} cx={x} cy={y} r="10" />))}
        </g>
      );
      case "hair_wavy":     return <path d="M66 78 Q74 48 88 62 Q100 44 110 62 Q124 48 134 78 L132 90 Q116 82 100 84 Q84 82 68 90 Z" fill={hairFill} />;
      case "hair_long":     return (
        <g fill={hairFill}>
          <path d="M62 130 Q56 72 80 54 Q100 34 120 54 Q144 72 138 130 L128 130 Q134 86 124 76 Q118 82 110 82 L90 82 Q82 82 76 76 Q66 86 72 130 Z" />
        </g>
      );
      case "hair_ponytail": return (
        <g fill={hairFill}>
          <path d="M68 72 Q100 46 132 72 L132 86 Q120 78 100 78 Q80 78 68 86 Z" />
          <path d="M128 82 Q158 108 148 152 L138 148 Q144 118 124 92 Z" />
        </g>
      );
      case "hair_bun":      return (
        <g fill={hairFill}>
          <path d="M70 74 Q100 52 130 74 L130 84 Q115 78 100 78 Q85 78 70 84 Z" />
          <circle cx="100" cy="40" r="14" />
        </g>
      );
      case "hair_afro":     return <ellipse cx="100" cy="60" rx="50" ry="38" fill={hairFill} />;
      case "hair_dreads":   return (
        <g fill={hairFill}>
          <path d="M68 72 Q100 44 132 72 L132 84 L68 84 Z" />
          {[70,82,94,106,118,128].map((x,i)=><rect key={i} x={x} y="82" width="7" height="34" rx="3" />)}
        </g>
      );
      case "hair_braids":   return (
        <g fill={hairFill}>
          <path d="M68 74 Q100 48 132 74 L132 86 L68 86 Z" />
          <path d="M72 88 Q70 108 78 128" stroke={hairFill} strokeWidth="7" strokeLinecap="round" fill="none" />
          <path d="M128 88 Q130 108 122 128" stroke={hairFill} strokeWidth="7" strokeLinecap="round" fill="none" />
        </g>
      );
      case "hair_mohawk":   return <path d="M92 34 Q100 20 108 34 L108 84 L92 84 Z" fill={hairFill} />;
      case "hair_fade":
      case "hair_low_fade": return <path d="M70 74 Q100 50 130 74 L130 82 L118 84 L82 84 L70 82 Z" fill={hairFill} />;
      case "hair_mid_fade": return <path d="M70 70 Q100 46 130 70 L130 82 L118 84 L82 84 L70 82 Z" fill={hairFill} />;
      case "hair_high_fade":return <path d="M70 64 Q100 42 130 64 L130 82 L118 84 L82 84 L70 82 Z" fill={hairFill} />;
      case "hair_undercut": return (
        <g fill={hairFill}>
          <path d="M74 74 Q100 42 126 74 L126 84 L74 84 Z" />
          <path d="M124 74 Q140 82 130 96 L118 92 Z" opacity="0.6" />
        </g>
      );
      case "hair_slicked":  return <path d="M68 76 Q100 56 132 76 Q136 72 130 84 L70 84 Q64 72 68 76 Z" fill={hairFill} />;
      default:              return <path d="M70 72 Q100 50 130 72 L130 82 L70 82 Z" fill={hairFill} />;
    }
  };

  const renderBeard = () => {
    if (!beard || beard.id === "fh_clean") return null;
    const c = hairColor;
    switch (beard.id) {
      case "fh_stubble":  return <path d="M78 108 Q100 124 122 108 Q124 116 100 122 Q76 116 78 108 Z" fill={c} opacity={0.45} />;
      case "fh_goatee":   return <path d="M94 112 Q100 126 106 112 L106 124 Q100 130 94 124 Z" fill={c} />;
      case "fh_mustache": return <path d="M86 104 Q100 110 114 104 Q108 108 100 108 Q92 108 86 104 Z" fill={c} />;
      case "fh_full":     return <path d="M74 100 Q78 126 100 128 Q122 126 126 100 Q122 118 100 120 Q78 118 74 100 Z" fill={c} />;
    }
  };

  const renderMouth = () => {
    switch (expr?.id) {
      case "exp_smile":       return <path d="M92 116 Q100 124 108 116" stroke="#5b2a1f" strokeWidth="2" fill="#c94a4a" strokeLinecap="round" />;
      case "exp_happy":       return <path d="M90 114 Q100 128 110 114 Q100 122 90 114 Z" fill="#c94a4a" stroke="#5b2a1f" strokeWidth="1.2" />;
      case "exp_confident":   return <path d="M92 116 Q102 122 110 114" stroke="#5b2a1f" strokeWidth="2" fill="none" strokeLinecap="round" />;
      case "exp_focused":     return <path d="M92 118 L108 118" stroke="#5b2a1f" strokeWidth="2" strokeLinecap="round" />;
      case "exp_determined":  return <path d="M91 118 Q100 114 109 118" stroke="#5b2a1f" strokeWidth="2.2" fill="none" strokeLinecap="round" />;
      case "exp_competitive": return <path d="M90 117 L110 117 L108 121 L92 121 Z" fill="#c94a4a" stroke="#5b2a1f" strokeWidth="1" />;
      default:                return <path d="M93 117 Q100 120 107 117" stroke="#5b2a1f" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.75" />;
    }
  };

  // Silhouette params derived from physique
  const shoulderX = 42 * P.shoulder;   // half-width at shoulder
  const chestX    = 38 * P.chest;
  const waistX    = 26 * P.waist;
  const armW      = 12 * P.arm;
  const thighX    = 14 * P.thigh;

  // Rotation transform (fake 3D via CSS)
  const rot = Math.max(-60, Math.min(60, rotationY));

  // ---- Trainer trail effect for special shoes ----
  const trail = shoesId === "shoes_fire" ? "#f97316" : shoesId === "shoes_lightning" ? "#facc15" : shoesId === "shoes_stars" ? "#a78bfa" : null;

  return (
    <div className={cn("relative", className)} style={{ width: size, height: size, perspective: 1200 }}>
      {/* Aura layers */}
      {acc?.id === "acc_aura" && (
        <motion.div className="absolute inset-4 rounded-full blur-3xl pointer-events-none"
          style={{ background: acc.color, opacity: 0.35 }}
          animate={animated ? { scale: [1, 1.15, 1], opacity: [0.25, 0.55, 0.25] } : {}}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }} />
      )}
      {acc?.id === "acc_gold_aura" && (
        <motion.div className="absolute inset-4 rounded-full blur-3xl pointer-events-none"
          style={{ background: acc.color, opacity: 0.4 }}
          animate={animated ? { scale: [1, 1.12, 1], opacity: [0.3, 0.6, 0.3] } : {}}
          transition={{ duration: 3.6, repeat: Infinity }} />
      )}
      {acc?.id === "acc_fire" && (
        <motion.div className="absolute inset-x-8 bottom-8 h-40 rounded-full blur-2xl pointer-events-none"
          style={{ background: `radial-gradient(circle, #f97316 0%, transparent 70%)` }}
          animate={animated ? { scale: [1, 1.2, 1], opacity: [0.4, 0.8, 0.4] } : {}}
          transition={{ duration: 1.6, repeat: Infinity }} />
      )}
      {acc?.id === "acc_lightning" && (
        <motion.div className="absolute inset-0 mix-blend-screen pointer-events-none"
          style={{ background: `radial-gradient(circle at 50% 30%, #facc1580, transparent 60%)` }}
          animate={animated ? { opacity: [0.4, 0.95, 0.4] } : {}}
          transition={{ duration: 1.2, repeat: Infinity }} />
      )}
      {acc?.id === "acc_rainbow" && (
        <motion.div className="absolute inset-0 pointer-events-none"
          style={{ background: "conic-gradient(from 0deg, #f43f5e, #f59e0b, #22c55e, #38bdf8, #a855f7, #f43f5e)", opacity: 0.16, borderRadius: 9999, filter: "blur(30px)" }}
          animate={animated ? { rotate: 360 } : {}}
          transition={{ duration: 12, repeat: Infinity, ease: "linear" }} />
      )}

      {/* Particle effects */}
      {acc?.id === "acc_snow" && animated && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 14 }).map((_, i) => (
            <motion.div key={i} className="absolute w-1.5 h-1.5 rounded-full bg-white/80"
              style={{ left: `${(i * 7) % 100}%`, top: -6 }}
              animate={{ y: [0, size], opacity: [0, 1, 0] }}
              transition={{ duration: 4 + (i % 5), repeat: Infinity, delay: i * 0.3, ease: "linear" }} />
          ))}
        </div>
      )}
      {acc?.id === "acc_stars" && animated && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 12 }).map((_, i) => (
            <motion.div key={i} className="absolute w-1 h-1 rounded-full bg-violet-300"
              style={{ left: `${(i * 8 + 5) % 100}%`, top: `${(i * 13) % 90}%` }}
              animate={{ opacity: [0, 1, 0], scale: [0.5, 1.4, 0.5] }}
              transition={{ duration: 2 + (i % 3), repeat: Infinity, delay: i * 0.25 }} />
          ))}
        </div>
      )}
      {acc?.id === "acc_leaves" && animated && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 10 }).map((_, i) => (
            <motion.div key={i} className="absolute text-emerald-400 text-xs"
              style={{ left: `${(i * 11) % 100}%`, top: -8 }}
              animate={{ y: [0, size + 20], x: [0, 20, -20, 0], rotate: [0, 180, 360] }}
              transition={{ duration: 6 + (i % 4), repeat: Infinity, delay: i * 0.5, ease: "linear" }}>🍃</motion.div>
          ))}
        </div>
      )}
      {acc?.id === "acc_smoke" && animated && (
        <motion.div className="absolute inset-x-10 bottom-10 h-24 rounded-full blur-2xl pointer-events-none"
          style={{ background: "radial-gradient(circle, #64748b90, transparent 70%)" }}
          animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 3, repeat: Infinity }} />
      )}
      {acc?.id === "acc_wings" && (
        <motion.div className="absolute inset-x-0 top-[38%] text-center text-7xl select-none pointer-events-none"
          style={{ filter: `drop-shadow(0 0 14px ${acc.color})` }}
          animate={animated ? { y: [0, -4, 0] } : {}}
          transition={{ duration: 2.4, repeat: Infinity }}>🪽</motion.div>
      )}

      {/* Trainer trail */}
      {trail && animated && (
        <div className="absolute inset-x-0 bottom-6 h-6 pointer-events-none flex justify-center">
          <motion.div className="w-24 h-6 rounded-full blur-lg"
            style={{ background: trail, opacity: 0.6 }}
            animate={{ opacity: [0.3, 0.8, 0.3], scaleX: [0.6, 1.1, 0.6] }}
            transition={{ duration: 1, repeat: Infinity }} />
        </div>
      )}

      {/* Character 3D wrapper */}
      <motion.div
        className="absolute inset-0 flex items-end justify-center"
        style={{ transformStyle: "preserve-3d", transform: `rotateY(${rot}deg) scale(${zoom})` }}
        animate={animated ? { y: [0, -3, 0] } : {}}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg viewBox="0 0 200 420" width={size} height={size} className="overflow-visible" style={{ filter: "drop-shadow(0 24px 24px rgba(0,0,0,0.55))" }}>
          {/* Ground shadow */}
          <motion.ellipse cx="100" cy="410" rx="52" ry="6" fill="#000" opacity="0.55"
            animate={animated ? { rx: [52, 50, 52], opacity: [0.55, 0.45, 0.55] } : {}}
            transition={{ duration: 4, repeat: Infinity }} />

          {/* Breathing torso group */}
          <motion.g animate={animated ? { scaleY: [1, 1.015, 1] } : {}} transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: "100px 220px" }}>
            {/* ==== LEGS ==== */}
            {/* Upper legs (pants) */}
            <path d={`M ${100 - thighX - 2} 260 Q ${100 - thighX - 6} 320 ${100 - thighX} 356 L ${100 - 4} 360 L ${100 - 4} 260 Z`} fill={pants} />
            <path d={`M ${100 + thighX + 2} 260 Q ${100 + thighX + 6} 320 ${100 + thighX} 356 L ${100 + 4} 360 L ${100 + 4} 260 Z`} fill={pants} />
            {/* Skin lower legs */}
            <path d={`M ${100 - thighX + 1} 356 Q ${100 - thighX - 1} 372 ${100 - thighX} 384 L ${100 - 6} 384 L ${100 - 5} 360 Z`} fill={skin} />
            <path d={`M ${100 + thighX - 1} 356 Q ${100 + thighX + 1} 372 ${100 + thighX} 384 L ${100 + 6} 384 L ${100 + 5} 360 Z`} fill={skin} />
            {/* Socks */}
            <rect x={100 - thighX - 6} y={382} width={13} height={8} rx={2} fill="#fff" opacity={0.9} />
            <rect x={100 + thighX - 7} y={382} width={13} height={8} rx={2} fill="#fff" opacity={0.9} />
            {/* Trainers with sole */}
            <g>
              <path d={`M ${100 - thighX - 12} 396 Q ${100 - thighX - 4} 388 ${100 - thighX + 6} 388 L ${100 - thighX + 12} 388 Q ${100 - thighX + 14} 400 ${100 - thighX - 12} 400 Z`} fill={shoes} />
              <rect x={100 - thighX - 12} y={399} width={26} height={4} rx={2} fill="#fff" opacity={0.9} />
              <path d={`M ${100 + thighX - 12} 396 Q ${100 + thighX - 4} 388 ${100 + thighX + 6} 388 L ${100 + thighX + 12} 388 Q ${100 + thighX + 14} 400 ${100 + thighX - 12} 400 Z`} fill={shoes} />
              <rect x={100 + thighX - 12} y={399} width={26} height={4} rx={2} fill="#fff" opacity={0.9} />
            </g>

            {/* ==== TORSO (outfit) with subtle shading ==== */}
            <path
              d={`M ${100 - shoulderX} 148 Q ${100 - shoulderX - 4} 150 ${100 - chestX} 190 Q ${100 - waistX} 240 ${100 - waistX - 2} 262 L ${100 + waistX + 2} 262 Q ${100 + waistX} 240 ${100 + chestX} 190 Q ${100 + shoulderX + 4} 150 ${100 + shoulderX} 148 Z`}
              fill={outfit}
            />
            {/* Fabric fold shading */}
            <path d={`M ${100 - chestX + 8} 190 Q 100 220 ${100 + chestX - 8} 190`} stroke="#000" strokeWidth="1" fill="none" opacity="0.08" />
            <path d={`M 100 148 L 100 260`} stroke="#000" strokeWidth="1" fill="none" opacity="0.1" />
            {/* Neckline */}
            <path d={`M ${100 - 14} 148 Q 100 160 ${100 + 14} 148`} stroke="#000" strokeWidth="1.5" fill="none" opacity="0.25" />
            {/* Waistband */}
            <rect x={100 - waistX - 2} y={258} width={(waistX + 2) * 2} height={5} fill="#000" opacity={0.18} />

            {/* Neck */}
            <path d={`M ${100 - 10 * P.neck} 132 L ${100 - 8 * P.neck} 152 L ${100 + 8 * P.neck} 152 L ${100 + 10 * P.neck} 132 Z`} fill={skin} />
            <ellipse cx="100" cy="150" rx={10 * P.neck} ry="3" fill="#000" opacity="0.15" />
          </motion.g>

          {/* ==== ARMS ==== */}
          {armsUp ? (
            <g>
              {/* Left */}
              <motion.g animate={animated ? { rotate: [-2, 2, -2] } : {}} style={{ transformOrigin: `${100 - shoulderX}px 155px` }} transition={{ duration: 2.5, repeat: Infinity }}>
                <path d={`M ${100 - shoulderX} 156 Q ${100 - shoulderX - 20} 100 ${100 - shoulderX - 6} 60`} stroke={skin} strokeWidth={armW} strokeLinecap="round" fill="none" />
                {(!gloves || gloves.id === "gloves_none") ? (
                  <circle cx={100 - shoulderX - 6} cy={56} r={armW * 0.55} fill={skin} />
                ) : (
                  <circle cx={100 - shoulderX - 6} cy={56} r={armW * 0.7} fill={gloves.color} />
                )}
              </motion.g>
              <motion.g animate={animated ? { rotate: [2, -2, 2] } : {}} style={{ transformOrigin: `${100 + shoulderX}px 155px` }} transition={{ duration: 2.5, repeat: Infinity }}>
                <path d={`M ${100 + shoulderX} 156 Q ${100 + shoulderX + 20} 100 ${100 + shoulderX + 6} 60`} stroke={skin} strokeWidth={armW} strokeLinecap="round" fill="none" />
                {(!gloves || gloves.id === "gloves_none") ? (
                  <circle cx={100 + shoulderX + 6} cy={56} r={armW * 0.55} fill={skin} />
                ) : (
                  <circle cx={100 + shoulderX + 6} cy={56} r={armW * 0.7} fill={gloves.color} />
                )}
              </motion.g>
            </g>
          ) : flexing ? (
            <g>
              <path d={`M ${100 - shoulderX} 158 Q ${100 - shoulderX - 22} 200 ${100 - shoulderX - 6} 156 Q ${100 - shoulderX + 6} 140 ${100 - shoulderX + 8} 190`} stroke={skin} strokeWidth={armW + 2} strokeLinecap="round" fill={skin} opacity="0.95" />
              <path d={`M ${100 + shoulderX} 158 Q ${100 + shoulderX + 22} 200 ${100 + shoulderX + 6} 156 Q ${100 + shoulderX - 6} 140 ${100 + shoulderX - 8} 190`} stroke={skin} strokeWidth={armW + 2} strokeLinecap="round" fill={skin} opacity="0.95" />
            </g>
          ) : (
            <g>
              <motion.g animate={animated ? (running ? { rotate: [-25, 25, -25] } : { rotate: [-1.5, 1.5, -1.5] }) : {}}
                style={{ transformOrigin: `${100 - shoulderX}px 158px` }}
                transition={{ duration: running ? 0.6 : 3.5, repeat: Infinity, ease: "easeInOut" }}>
                {/* Upper arm */}
                <path d={`M ${100 - shoulderX} 156 Q ${100 - shoulderX - 8} 200 ${100 - shoulderX - 4} 234`} stroke={outfit} strokeWidth={armW + 4} strokeLinecap="round" fill="none" />
                <path d={`M ${100 - shoulderX} 158 Q ${100 - shoulderX - 6} 200 ${100 - shoulderX - 2} 232`} stroke={skin} strokeWidth={armW} strokeLinecap="round" fill="none" />
                {/* Lower arm */}
                <path d={`M ${100 - shoulderX - 2} 232 Q ${100 - shoulderX - 6} 258 ${100 - shoulderX - 2} 280`} stroke={skin} strokeWidth={armW - 1} strokeLinecap="round" fill="none" />
                {/* Hand */}
                {(!gloves || gloves.id === "gloves_none") ? (
                  <g>
                    <ellipse cx={100 - shoulderX - 2} cy={286} rx={armW * 0.55} ry={armW * 0.7} fill={skin} />
                    {/* Fingers */}
                    <path d={`M ${100 - shoulderX - 6} 290 L ${100 - shoulderX - 6} 296 M ${100 - shoulderX - 2} 292 L ${100 - shoulderX - 2} 298 M ${100 - shoulderX + 2} 290 L ${100 - shoulderX + 2} 295`} stroke={skin} strokeWidth="2.4" strokeLinecap="round" />
                  </g>
                ) : (
                  <ellipse cx={100 - shoulderX - 2} cy={286} rx={armW * 0.7} ry={armW * 0.8} fill={gloves.color} />
                )}
              </motion.g>
              <motion.g animate={animated ? (running ? { rotate: [25, -25, 25] } : { rotate: [1.5, -1.5, 1.5] }) : {}}
                style={{ transformOrigin: `${100 + shoulderX}px 158px` }}
                transition={{ duration: running ? 0.6 : 3.5, repeat: Infinity, ease: "easeInOut" }}>
                <path d={`M ${100 + shoulderX} 156 Q ${100 + shoulderX + 8} 200 ${100 + shoulderX + 4} 234`} stroke={outfit} strokeWidth={armW + 4} strokeLinecap="round" fill="none" />
                <path d={`M ${100 + shoulderX} 158 Q ${100 + shoulderX + 6} 200 ${100 + shoulderX + 2} 232`} stroke={skin} strokeWidth={armW} strokeLinecap="round" fill="none" />
                <path d={`M ${100 + shoulderX + 2} 232 Q ${100 + shoulderX + 6} 258 ${100 + shoulderX + 2} 280`} stroke={skin} strokeWidth={armW - 1} strokeLinecap="round" fill="none" />
                {(!gloves || gloves.id === "gloves_none") ? (
                  <g>
                    <ellipse cx={100 + shoulderX + 2} cy={286} rx={armW * 0.55} ry={armW * 0.7} fill={skin} />
                    <path d={`M ${100 + shoulderX + 6} 290 L ${100 + shoulderX + 6} 296 M ${100 + shoulderX + 2} 292 L ${100 + shoulderX + 2} 298 M ${100 + shoulderX - 2} 290 L ${100 + shoulderX - 2} 295`} stroke={skin} strokeWidth="2.4" strokeLinecap="round" />
                  </g>
                ) : (
                  <ellipse cx={100 + shoulderX + 2} cy={286} rx={armW * 0.7} ry={armW * 0.8} fill={gloves.color} />
                )}
              </motion.g>
            </g>
          )}

          {/* ==== HEAD ==== */}
          <motion.g animate={animated ? { rotate: dancing ? [-3, 3, -3] : [-0.8, 0.8, -0.8] } : {}}
            transition={{ duration: dancing ? 1.2 : 5, repeat: Infinity, ease: "easeInOut" }}
            style={{ transformOrigin: "100px 100px" }}>

            {/* Ears */}
            <ellipse cx={100 - faceRx + 1} cy={100} rx="5" ry="8" fill={skin} />
            <ellipse cx={100 + faceRx - 1} cy={100} rx="5" ry="8" fill={skin} />
            <ellipse cx={100 - faceRx + 1} cy={102} rx="2" ry="3" fill="#000" opacity="0.15" />
            <ellipse cx={100 + faceRx - 1} cy={102} rx="2" ry="3" fill="#000" opacity="0.15" />

            {/* Head */}
            <ellipse cx="100" cy="92" rx={faceRx} ry={faceRy} fill={skin} />
            {/* Jaw shading */}
            <path d={`M ${100 - faceRx + 4} 108 Q 100 ${92 + faceRy + 4} ${100 + faceRx - 4} 108`} fill="#000" opacity="0.08" />
            {/* Cheek highlight */}
            <ellipse cx="88" cy="100" rx="6" ry="4" fill="#fff" opacity="0.08" />

            {/* Hair */}
            {renderHair()}

            {/* Brows */}
            {brows && (
              brows.id === "brow_arched" ? (
                <g>
                  <motion.path d="M84 82 Q90 76 96 82" stroke={hairColor} strokeWidth="3" fill="none" strokeLinecap="round"
                    animate={animated && expr?.id === "exp_determined" ? { y: [-1, 0, -1] } : {}} transition={{ duration: 2, repeat: Infinity }} />
                  <path d="M104 82 Q110 76 116 82" stroke={hairColor} strokeWidth="3" fill="none" strokeLinecap="round" />
                </g>
              ) : brows.id === "brow_thick" ? (
                <>
                  <rect x="82" y="80" width="16" height="4.5" rx="2" fill={hairColor} />
                  <rect x="102" y="80" width="16" height="4.5" rx="2" fill={hairColor} />
                </>
              ) : brows.id === "brow_thin" ? (
                <>
                  <rect x="84" y="82" width="14" height="2" rx="1" fill={hairColor} />
                  <rect x="102" y="82" width="14" height="2" rx="1" fill={hairColor} />
                </>
              ) : (
                <>
                  <rect x="83" y="81" width="15" height="3" rx="1.5" fill={hairColor} />
                  <rect x="102" y="81" width="15" height="3" rx="1.5" fill={hairColor} />
                </>
              )
            )}

            {/* Eyes */}
            <g>
              {/* Whites */}
              <ellipse cx="91" cy="92" rx="4.5" ry={blink ? 0.5 : 4} fill="#fff" />
              <ellipse cx="109" cy="92" rx="4.5" ry={blink ? 0.5 : 4} fill="#fff" />
              {!blink && (
                <>
                  {/* Glow for premium eye colors */}
                  {(loadout.eye_color === "eye_glow" || loadout.eye_color === "eye_lightning" || loadout.eye_color === "eye_neon" || loadout.eye_color === "eye_gold") && (
                    <>
                      <circle cx="91" cy="92" r="6" fill={eyeColor} opacity="0.35" style={{ filter: `blur(3px)` }} />
                      <circle cx="109" cy="92" r="6" fill={eyeColor} opacity="0.35" style={{ filter: `blur(3px)` }} />
                    </>
                  )}
                  <circle cx="91" cy="92" r="2.8" fill={eyeColor} />
                  <circle cx="109" cy="92" r="2.8" fill={eyeColor} />
                  <circle cx="91.8" cy="91.2" r="0.9" fill="#fff" />
                  <circle cx="109.8" cy="91.2" r="0.9" fill="#fff" />
                </>
              )}
            </g>

            {/* Nose */}
            <path d="M100 98 Q97 106 100 108 Q103 106 100 98 Z" fill="#000" opacity="0.15" />

            {/* Mouth (expression) */}
            {renderMouth()}

            {/* Freckles / face paint / metal etc. */}
            {loadout.skin_tone === "tone_freckles" && (
              <g fill="#8b5a3c" opacity="0.7">
                <circle cx="87" cy="102" r="0.9" /><circle cx="90" cy="105" r="0.9" />
                <circle cx="94" cy="103" r="0.9" /><circle cx="110" cy="103" r="0.9" />
                <circle cx="113" cy="105" r="0.9" /><circle cx="107" cy="102" r="0.9" />
              </g>
            )}
            {loadout.skin_tone === "tone_warpaint" && (
              <path d="M78 96 L122 96 L120 102 L80 102 Z" fill="#dc2626" opacity="0.85" />
            )}
            {loadout.skin_tone === "tone_metallic" && (
              <ellipse cx="100" cy="92" rx={faceRx} ry={faceRy} fill="url(#chrome)" opacity="0.4" />
            )}

            {/* Beard */}
            {renderBeard()}

            {/* Headgear */}
            {head?.id === "head_band"    && <rect x="66" y="80" width="68" height="7" rx="2" fill={head.color} />}
            {head?.id === "head_cap_blk" && <><path d="M64 74 Q100 46 136 74 L136 88 L64 88 Z" fill={head.color} /><path d="M64 84 L156 84 L156 92 L64 92 Z" fill={head.color} /></>}
            {head?.id === "head_cap_wht" && <><path d="M64 74 Q100 46 136 74 L136 88 L64 88 Z" fill={head.color} /><path d="M64 84 L156 84 L156 92 L64 92 Z" fill={head.color} /></>}
            {head?.id === "head_beanie"  && <path d="M62 84 Q62 44 100 42 Q138 44 138 84 Z" fill={head.color} />}
            {head?.id === "head_bucket"  && <><ellipse cx="100" cy="82" rx="40" ry="8" fill={head.color} /><path d="M70 80 Q70 54 100 52 Q130 54 130 80 Z" fill={head.color} /></>}
            {head?.id === "head_visor"   && <path d="M58 82 Q100 60 142 82 L142 90 L58 90 Z" fill={head.color} opacity="0.9" />}
            {head?.id === "head_helmet"  && <path d="M62 92 Q100 38 138 92 L138 102 L62 102 Z" fill={head.color} />}
            {head?.id === "head_crown"   && <path d="M68 68 L82 44 L94 68 L106 42 L118 68 L132 44 L136 78 L64 78 Z" fill={head.color} stroke="#92400e" strokeWidth="1" />}
            {head?.id === "head_halo"    && <ellipse cx="100" cy="46" rx="38" ry="6" fill="none" stroke={head.color} strokeWidth="3" style={{ filter: `drop-shadow(0 0 10px ${head.color})` }} />}
            {head?.id === "head_horns"   && (
              <g fill={head.color}>
                <path d="M74 72 Q60 52 78 40 Q82 58 86 72 Z" />
                <path d="M126 72 Q140 52 122 40 Q118 58 114 72 Z" />
              </g>
            )}

            {/* Glasses / Chain / Headphones / Watch */}
            {acc?.id === "acc_glasses" && (
              <g stroke="#0a0a0a" strokeWidth="2" fill="none">
                <circle cx="91" cy="93" r="7" fill={acc.color} opacity="0.4" />
                <circle cx="109" cy="93" r="7" fill={acc.color} opacity="0.4" />
                <line x1="97" y1="93" x2="103" y2="93" />
              </g>
            )}
            {acc?.id === "acc_headphones" && (
              <g>
                <path d="M64 78 Q100 42 136 78" stroke="#0a0a0a" strokeWidth="4" fill="none" />
                <circle cx="66" cy="96" r="7" fill="#0a0a0a" />
                <circle cx="134" cy="96" r="7" fill="#0a0a0a" />
              </g>
            )}
          </motion.g>

          {/* Chain on chest */}
          {acc?.id === "acc_chain" && (
            <path d="M84 160 Q100 176 116 160" stroke={acc.color} strokeWidth="3" fill="none" />
          )}
          {/* Watch on wrist */}
          {acc?.id === "acc_watch" && (
            <rect x={100 + shoulderX - 6} y={274} width={12} height={6} rx={1.5} fill={acc.color} />
          )}
          {/* Water bottle in hand */}
          {acc?.id === "acc_bottle" && (
            <g>
              <rect x={100 + shoulderX - 3} y={292} width={12} height={22} rx={2} fill={acc.color} />
              <rect x={100 + shoulderX - 1} y={288} width={8} height={4} rx={1} fill="#0a0a0a" />
            </g>
          )}
          {/* Backpack straps */}
          {acc?.id === "acc_backpack" && (
            <g>
              <path d={`M ${100 - shoulderX + 6} 150 L ${100 - shoulderX + 10} 240`} stroke={acc.color} strokeWidth="6" strokeLinecap="round" />
              <path d={`M ${100 + shoulderX - 6} 150 L ${100 + shoulderX - 10} 240`} stroke={acc.color} strokeWidth="6" strokeLinecap="round" />
            </g>
          )}

          <defs>
            <linearGradient id="chrome" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#e2e8f0" />
              <stop offset="0.5" stopColor="#94a3b8" />
              <stop offset="1" stopColor="#cbd5e1" />
            </linearGradient>
          </defs>
        </svg>
      </motion.div>

      {/* Badge */}
      {showBadge && badge && badge.id !== "badge_none" && (
        <motion.div className="absolute top-3 right-3 text-2xl drop-shadow-[0_0_10px_rgba(0,0,0,0.7)]"
          initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}>
          {badge.glyph || "⭐"}
        </motion.div>
      )}
    </div>
  );
}
