import { Palette, Check, ToggleLeft, ToggleRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { THEMES, findThemeIndex } from "../../theme/themes";
import type { Intensity } from "../../theme/apply";
import { useThemeStore } from "../../stores/themeStore";

const INTENSITY_OPTS: { id: Intensity; label: string }[] = [
  { id: "subtle", label: "Subtle" },
  { id: "medium", label: "Medium" },
  { id: "lively", label: "Lively" },
];

export function AppearanceCard() {
  const theme = useThemeStore((s) => s.theme);
  const palette = useThemeStore((s) => s.palette);
  const anim = useThemeStore((s) => s.anim);
  const motion = useThemeStore((s) => s.motion);
  const intensity = useThemeStore((s) => s.intensity);
  const sync = useThemeStore((s) => s.sync);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setPalette = useThemeStore((s) => s.setPalette);
  const setAnim = useThemeStore((s) => s.setAnim);
  const setMotion = useThemeStore((s) => s.setMotion);
  const setIntensity = useThemeStore((s) => s.setIntensity);
  const setSync = useThemeStore((s) => s.setSync);

  const cur = THEMES[findThemeIndex(theme)];

  return (
    <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-5">
      <div className="flex items-center gap-2">
        <Palette className="w-4 h-4 text-brand-400" />
        <h2 className="text-sm font-semibold text-zinc-300">Appearance</h2>
      </div>
      <p className="text-xs text-zinc-500">
        Skin MegaLoad in any of Valheim's biomes, with an optional ambient animation drifting behind the panels.
      </p>

      {/* Theme picker */}
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium">Theme</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {THEMES.map((t) => {
            const p0 = t.palettes[0];
            const active = t.id === theme;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  "text-left rounded-lg border p-2 transition-colors",
                  active
                    ? "border-brand-500 bg-brand-500/10"
                    : "border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700"
                )}
              >
                <div
                  className="h-6 rounded-md mb-1.5 border border-black/30"
                  style={{ background: `linear-gradient(135deg, ${p0.bg2}, ${p0.panel} 55%, ${p0.accent})` }}
                />
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-medium text-zinc-200 truncate">{t.name}</span>
                  {active && <Check className="w-3 h-3 text-brand-400 shrink-0" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Palette variant */}
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium">Palette</label>
        <div className="flex flex-wrap gap-2">
          {cur.palettes.map((p, i) => {
            const active = i === palette;
            return (
              <button
                key={p.id}
                onClick={() => setPalette(i)}
                title={p.desc}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                  active ? "border-brand-500 bg-brand-500/10 text-zinc-100" : "border-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                )}
              >
                <span className="w-4 h-4 rounded-full border border-white/15 shrink-0" style={{ background: `linear-gradient(135deg, ${p.accent2}, ${p.accent})` }} />
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Background motion */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-300 font-medium">Background motion</p>
          <p className="text-[10px] text-zinc-600">Ambient animation behind the UI. Pauses when the window is minimised.</p>
        </div>
        <button onClick={() => setMotion(!motion)} className="shrink-0" title={motion ? "Turn motion off" : "Turn motion on"}>
          {motion ? <ToggleRight className="w-8 h-8 text-brand-400" /> : <ToggleLeft className="w-8 h-8 text-zinc-600" />}
        </button>
      </div>

      {/* Animation variant + intensity — dimmed when motion is off */}
      <div className={cn("space-y-4", !motion && "opacity-40 pointer-events-none select-none")}>
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium">Animation</label>
          <div className="flex flex-wrap gap-2">
            {cur.anims.map((a, i) => {
              const active = i === anim;
              const still = a.layers.length === 0;
              return (
                <button
                  key={a.id}
                  onClick={() => setAnim(i)}
                  title={a.desc}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                    active ? "border-brand-500 bg-brand-500/10 text-zinc-100" : "border-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: still ? "rgb(var(--ml-zinc-800))" : "rgb(var(--ml-brand-400))" }}
                  />
                  {a.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium">Intensity</label>
          <div className="inline-grid grid-cols-3 gap-1 rounded-lg border border-zinc-800/60 p-1 bg-zinc-900/40">
            {INTENSITY_OPTS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setIntensity(opt.id)}
                className={cn(
                  "px-4 py-1.5 rounded-md text-xs font-medium transition-colors",
                  intensity === opt.id ? "bg-brand-500/15 text-brand-400" : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sync theme */}
      <div className="flex items-center justify-between pt-1 border-t border-zinc-800/40">
        <div>
          <p className="text-xs text-zinc-300 font-medium">Sync theme across devices</p>
          <p className="text-[10px] text-zinc-600">Off by default. Uses Cloud Sync — enable that first for this to take effect.</p>
        </div>
        <button onClick={() => setSync(!sync)} className="shrink-0" title={sync ? "Stop syncing theme" : "Sync theme to your other devices"}>
          {sync ? <ToggleRight className="w-8 h-8 text-brand-400" /> : <ToggleLeft className="w-8 h-8 text-zinc-600" />}
        </button>
      </div>
    </div>
  );
}
