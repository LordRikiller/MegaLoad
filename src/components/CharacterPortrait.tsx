import { User } from "lucide-react";

/**
 * Stylised Norse viking portrait. Valheim doesn't export character renders,
 * so we build an SVG bust from save-file features: model (0=male, 1=female),
 * skin_color / hair_color (0-1 RGB), hair/beard style names.
 *
 * Aims for a weathered Norse warrior look — leather armour shoulders, fur
 * trim, war paint stripes, strong brow + cheekbones. Not pretty, not cute.
 */
export function CharacterPortrait({
  model,
  beard,
  hair,
  skinColor,
  hairColor,
  name,
  compact = false,
}: {
  model: number;
  beard: string;
  hair: string;
  skinColor: [number, number, number];
  hairColor: [number, number, number];
  name: string;
  /** If true, use a smaller ring + no labels under it (for dashboard side column). */
  compact?: boolean;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const toRgb = ([r, g, b]: [number, number, number], mul = 1) =>
    `rgb(${Math.round(clamp(r * mul) * 255)}, ${Math.round(clamp(g * mul) * 255)}, ${Math.round(clamp(b * mul) * 255)})`;
  const skin = toRgb(skinColor);
  const skinDark = toRgb(skinColor, 0.7);
  const skinDarker = toRgb(skinColor, 0.45);
  const hairRgb = toRgb(hairColor);
  const hairDark = toRgb(hairColor, 0.55);

  const isMale = model === 0;
  const hasBeard = isMale && beard && beard !== "No beard" && beard !== "BeardNone";
  const hairIdx = parseInt((hair.match(/\d+/)?.[0]) ?? "1", 10) || 1;
  const beardIdx = parseInt((beard.match(/\d+/)?.[0]) ?? "1", 10) || 1;

  const prettyHair = hair ? hair.replace(/Hair/, "Hair ") : "—";
  const prettyBeard = beard && hasBeard ? beard.replace(/Beard/, "Beard ") : "Clean-shaven";

  const seed = (name.charCodeAt(0) + name.length) % 3;
  const paintColor = ["#7a1c1c", "#1c3a7a", "#1a1a1a"][seed];

  const sizeClass = compact ? "w-24 h-24" : "w-36 h-36";

  const svg = (
    <svg viewBox="0 0 120 120" className="w-full h-full">
      <defs>
        <radialGradient id="portrait-sky" cx="50%" cy="20%" r="85%">
          <stop offset="0%" stopColor="#2a3148" />
          <stop offset="60%" stopColor="#131a2c" />
          <stop offset="100%" stopColor="#050813" />
        </radialGradient>
        <linearGradient id="leather-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3d2a18" />
          <stop offset="100%" stopColor="#1a1008" />
        </linearGradient>
        <linearGradient id="fur-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6a553c" />
          <stop offset="100%" stopColor="#3a2d1e" />
        </linearGradient>
      </defs>

      <rect width="120" height="120" fill="url(#portrait-sky)" />
      <rect x="0" y="85" width="120" height="35" fill="rgba(20,30,50,0.5)" />

      <path
        d="M 0 120 L 0 105 C 8 98, 22 94, 35 92 L 48 88 Q 60 86, 72 88 L 85 92 C 98 94, 112 98, 120 105 L 120 120 Z"
        fill="url(#leather-grad)"
      />
      <path
        d="M 18 94 Q 30 84, 48 86 Q 60 82, 72 86 Q 90 84, 102 94 Q 90 90, 72 92 Q 60 88, 48 92 Q 30 90, 18 94 Z"
        fill="url(#fur-grad)"
        opacity="0.95"
      />
      {[22, 30, 38, 48, 60, 72, 82, 90, 98].map((x, i) => (
        <circle key={i} cx={x} cy={89 + (i % 2) * 2} r="1.1" fill="#8b7355" opacity="0.7" />
      ))}

      <path d="M 52 76 L 52 88 L 68 88 L 68 76 Z" fill={skin} />
      <path d="M 52 86 L 52 88 L 68 88 L 68 86 Z" fill={skinDark} />

      {isMale ? (
        <path
          d="M 38 50 C 38 34, 46 26, 60 26 C 74 26, 82 34, 82 50 L 81 62 Q 80 72, 72 78 L 60 82 L 48 78 Q 40 72, 39 62 Z"
          fill={skin}
        />
      ) : (
        <path
          d="M 40 50 C 40 34, 48 26, 60 26 C 72 26, 80 34, 80 50 L 79 62 Q 77 70, 70 76 L 60 80 L 50 76 Q 43 70, 41 62 Z"
          fill={skin}
        />
      )}

      <path d="M 40 58 Q 42 70, 48 76 L 44 68 Q 41 63, 41 58 Z" fill={skinDark} opacity="0.5" />
      <path d="M 80 58 Q 78 70, 72 76 L 76 68 Q 79 63, 79 58 Z" fill={skinDark} opacity="0.5" />
      <path d="M 40 50 Q 44 42, 52 40 L 52 46 Q 46 50, 42 54 Z" fill={skinDark} opacity="0.35" />
      <path d="M 80 50 Q 76 42, 68 40 L 68 46 Q 74 50, 78 54 Z" fill={skinDark} opacity="0.35" />

      <rect x="42" y="52" width="36" height="3" fill={paintColor} opacity="0.85" />
      <rect x="42" y="55" width="36" height="3" fill={paintColor} opacity="0.6" />

      <path d="M 44 51 L 54 50 L 56 52 Z" fill={hairDark} />
      <path d="M 76 51 L 66 50 L 64 52 Z" fill={hairDark} />

      <ellipse cx="51" cy="56" rx="2.2" ry="1.6" fill="#fff" opacity="0.85" />
      <ellipse cx="69" cy="56" rx="2.2" ry="1.6" fill="#fff" opacity="0.85" />
      <circle cx="51" cy="56" r="1.2" fill="#1a2030" />
      <circle cx="69" cy="56" r="1.2" fill="#1a2030" />
      <circle cx="51.3" cy="55.6" r="0.4" fill="#fff" />
      <circle cx="69.3" cy="55.6" r="0.4" fill="#fff" />

      <path d="M 60 56 L 57 66 L 60 68 L 63 66 Z" fill={skinDark} opacity="0.45" />
      <path d="M 60 56 L 59 64" stroke={skinDarker} strokeWidth="0.7" opacity="0.6" />

      {!hasBeard && (
        <>
          <path d="M 54 72 Q 60 74, 66 72" stroke={skinDarker} strokeWidth="1.3" fill="none" strokeLinecap="round" />
          <path d="M 54 72 Q 60 76, 66 72" stroke={skinDarker} strokeWidth="0.6" fill="none" opacity="0.4" />
        </>
      )}

      {isMale && (
        <path d="M 68 58 L 74 66" stroke={skinDarker} strokeWidth="1" strokeLinecap="round" opacity="0.7" />
      )}

      {(() => {
        if (hairIdx >= 7) {
          return (
            <>
              <path
                d="M 36 46 C 34 26, 48 20, 60 20 C 72 20, 86 26, 84 46 L 90 100 L 86 105 L 82 70 Q 84 55, 80 48 C 72 44, 60 44, 48 48 Q 42 55, 40 70 L 34 105 L 30 100 Z"
                fill={hairRgb}
              />
              <path d="M 34 70 L 30 100" stroke={hairDark} strokeWidth="1" opacity="0.7" />
              <path d="M 40 65 L 36 100" stroke={hairDark} strokeWidth="1" opacity="0.7" />
              <path d="M 86 70 L 90 100" stroke={hairDark} strokeWidth="1" opacity="0.7" />
              <path d="M 80 65 L 84 100" stroke={hairDark} strokeWidth="1" opacity="0.7" />
              <path d="M 46 30 Q 60 26, 74 30" stroke={toRgb(hairColor, 1.25)} strokeWidth="1" fill="none" opacity="0.5" />
            </>
          );
        } else if (hairIdx >= 4) {
          return (
            <>
              <path
                d="M 36 48 C 34 28, 48 22, 60 22 C 72 22, 86 28, 84 48 L 84 70 L 78 72 L 78 52 C 78 42, 72 38, 60 38 C 48 38, 42 42, 42 52 L 42 72 L 36 70 Z"
                fill={hairRgb}
              />
              <path d="M 48 38 L 52 48" stroke={hairDark} strokeWidth="1" opacity="0.7" />
              <path d="M 60 38 L 58 48" stroke={hairDark} strokeWidth="1" opacity="0.7" />
              <path d="M 72 38 L 68 48" stroke={hairDark} strokeWidth="1" opacity="0.7" />
            </>
          );
        } else {
          return (
            <>
              <path
                d="M 40 50 C 38 32, 50 26, 60 26 C 70 26, 82 32, 80 50 C 78 46, 70 42, 60 42 C 50 42, 42 46, 40 50 Z"
                fill={hairRgb}
              />
              <path d="M 42 52 L 44 58" stroke={hairDark} strokeWidth="0.6" opacity="0.5" />
              <path d="M 78 52 L 76 58" stroke={hairDark} strokeWidth="0.6" opacity="0.5" />
            </>
          );
        }
      })()}

      {hasBeard && (() => {
        if (beardIdx >= 4) {
          return (
            <>
              <path
                d="M 42 68 Q 46 82, 52 92 L 58 98 L 60 95 L 62 98 L 68 92 Q 74 82, 78 68 Q 70 76, 60 76 Q 50 76, 42 68 Z"
                fill={hairRgb}
              />
              <path d="M 50 86 Q 60 89, 70 86" stroke={hairDark} strokeWidth="0.8" fill="none" />
              <circle cx="60" cy="88" r="1.2" fill={hairDark} />
              <path d="M 60 78 L 60 96" stroke={toRgb(hairColor, 1.2)} strokeWidth="0.5" opacity="0.5" />
            </>
          );
        } else {
          return (
            <>
              <path
                d="M 44 66 Q 46 78, 52 84 Q 56 88, 60 88 Q 64 88, 68 84 Q 74 78, 76 66 Q 70 72, 60 72 Q 50 72, 44 66 Z"
                fill={hairRgb}
              />
              <path d="M 48 74 L 50 82" stroke={hairDark} strokeWidth="0.7" opacity="0.6" />
              <path d="M 72 74 L 70 82" stroke={hairDark} strokeWidth="0.7" opacity="0.6" />
            </>
          );
        }
      })()}

      <circle cx="60" cy="88" r="2" fill="#c08a26" opacity="0.9" />
      <circle cx="60" cy="88" r="1" fill="#5f381d" />

      <rect width="120" height="120" fill="url(#portrait-sky)" opacity="0.15" />
    </svg>
  );

  if (compact) {
    return (
      <div className="flex flex-col items-center">
        <div className={`relative ${sizeClass} rounded-full overflow-hidden ring-2 ring-brand-500/50 shadow-lg shadow-brand-500/20 bg-gradient-to-b from-zinc-900 to-black`}>
          {svg}
        </div>
        <div className="mt-2 text-center">
          <div className="font-norse font-bold text-base text-zinc-100 tracking-wide leading-none">
            {name}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-4 overflow-hidden relative">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
        <User className="w-3.5 h-3.5" /> Portrait
      </h3>
      <div className="flex flex-col items-center">
        <div className={`relative ${sizeClass} rounded-full overflow-hidden ring-2 ring-brand-500/50 shadow-lg shadow-brand-500/20 bg-gradient-to-b from-zinc-900 to-black`}>
          {svg}
        </div>
        <div className="mt-3 text-center">
          <div className="font-norse font-bold text-xl text-zinc-100 tracking-wide leading-none">
            {name}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            {isMale ? "Male" : "Female"} · {prettyHair} · {prettyBeard}
          </div>
        </div>
      </div>
    </div>
  );
}
