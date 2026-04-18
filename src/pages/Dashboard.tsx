import { useEffect, useMemo } from "react";
import { useProfileStore } from "../stores/profileStore";
import { useModStore } from "../stores/modStore";
import { usePlayerDataStore } from "../stores/playerDataStore";
import { useUpdateStore } from "../stores/updateStore";
import {
  Package,
  Users,
  Settings2,
  Globe,
  Gamepad2,
  Skull,
  Swords,
  Hammer,
  Crown,
  Flame,
  Heart,
  Zap,
  Sparkles,
  MapPin,
  TrendingUp,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

/** Top N skills by level, filtered to levels > 0 */
function topSkills(skills: { name: string; level: number }[], n = 3) {
  return [...skills]
    .filter((s) => s.level > 0)
    .sort((a, b) => b.level - a.level)
    .slice(0, n);
}

/** Pretty-print a skill name: "BloodMagic" → "Blood Magic" */
function prettySkillName(name: string): string {
  return name.replace(/([A-Z])/g, " $1").trim();
}

export function Dashboard() {
  const { activeProfileId, fetchProfiles, activeProfile } = useProfileStore();
  const { mods, fetchMods } = useModStore();
  const { character, characters } = usePlayerDataStore();
  const { sessionUpdatedMods, updateResult } = useUpdateStore();
  const navigate = useNavigate();
  const profile = activeProfile();

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  useEffect(() => {
    if (profile?.bepinex_path) fetchMods(profile.bepinex_path);
  }, [profile?.bepinex_path, fetchMods]);

  const skillSum = useMemo(
    () => character?.skills.reduce((s, k) => s + Math.floor(k.level), 0) ?? 0,
    [character]
  );
  const top = useMemo(() => topSkills(character?.skills ?? []), [character]);

  const availableUpdates = updateResult?.mods.filter((m) => m.status === "outdated").length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      {/* ─── HERO BANNER ─── */}
      <div className="relative overflow-hidden rounded-2xl border border-brand-500/20">
        {/* Background layers */}
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-brand-950/40" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(192,138,38,0.18),transparent_60%)]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Cg fill='%23c08a26' fill-opacity='0.6'%3E%3Cpath d='M20 4 L20 36 M4 20 L36 20 M10 10 L30 30 M30 10 L10 30'/%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />
        <div className="relative px-8 py-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="text-[11px] font-semibold text-brand-500/80 uppercase tracking-[0.25em] mb-1">
                Valheim Mod Manager
              </div>
              <h1 className="font-norse font-bold text-5xl text-brand-300 leading-none tracking-wide">
                Skál, {profile?.name ?? "Warrior"}
              </h1>
              <p className="mt-3 text-sm text-zinc-400 max-w-xl leading-relaxed">
                {character
                  ? `${character.name} of the Tenth World — your saga continues.`
                  : profile
                    ? "Your mods are ready. Choose a character to see your saga."
                    : "Forge a profile to begin your journey through the Tenth World."}
              </p>
            </div>

            {/* Hero stats strip */}
            <div className="flex gap-6 items-center">
              <HeroStat icon={Package} label="Mods" value={mods.length} color="text-brand-300" />
              <div className="h-12 w-px bg-zinc-700/40" />
              <HeroStat icon={Users} label="Characters" value={characters.length} color="text-blue-300" />
              {character && (
                <>
                  <div className="h-12 w-px bg-zinc-700/40" />
                  <HeroStat
                    icon={TrendingUp}
                    label="Skill Sum"
                    value={skillSum}
                    color="text-emerald-300"
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── CHARACTER SAGA CARD + STATS ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Character card (spans 2 cols) */}
        <div className="lg:col-span-2 glass rounded-2xl p-6 border-zinc-800/50">
          {character ? (
            <>
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                    Your Hero
                  </div>
                  <h2 className="font-norse font-bold text-3xl text-zinc-100 leading-none tracking-wide">
                    {character.name}
                  </h2>
                  {character.guardian_power && (
                    <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-brand-400 bg-brand-500/10 border border-brand-500/20 rounded-full px-2.5 py-0.5">
                      <Crown className="w-3 h-3" />
                      {character.guardian_power}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => navigate("/player")}
                  className="text-[11px] text-zinc-500 hover:text-brand-400 transition-colors"
                >
                  View details →
                </button>
              </div>

              {/* Vitals bars */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <Vital
                  icon={Heart}
                  label="Health"
                  value={Math.round(character.hp)}
                  max={Math.round(character.max_hp)}
                  color="from-red-600 to-red-500"
                  textColor="text-red-300"
                />
                <Vital
                  icon={Zap}
                  label="Stamina"
                  value={Math.round(character.stamina)}
                  max={Math.round(character.stamina)}
                  color="from-amber-600 to-amber-400"
                  textColor="text-amber-300"
                />
                <Vital
                  icon={Sparkles}
                  label="Eitr"
                  value={Math.round(character.max_eitr)}
                  max={Math.round(character.max_eitr)}
                  color="from-purple-600 to-fuchsia-500"
                  textColor="text-purple-300"
                />
              </div>

              {/* Saga stats row */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                <SagaStat icon={Skull} label="Deaths" value={character.deaths} color="text-zinc-300" />
                <SagaStat icon={Swords} label="Kills" value={character.kills} color="text-red-300" />
                <SagaStat icon={Crown} label="Bosses" value={character.boss_kills} color="text-amber-300" />
                <SagaStat icon={Hammer} label="Builds" value={character.builds} color="text-cyan-300" />
              </div>

              {/* Top skills */}
              {top.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                    Strongest Disciplines
                  </div>
                  <div className="space-y-1.5">
                    {top.map((s) => (
                      <div key={s.name} className="flex items-center gap-3">
                        <span className="text-xs text-zinc-300 w-24 shrink-0">{prettySkillName(s.name)}</span>
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full"
                            style={{ width: `${Math.min(100, s.level)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-brand-300 w-8 text-right">
                          {Math.floor(s.level)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="w-10 h-10 text-zinc-600 mb-3" />
              <h3 className="font-norse font-bold text-xl text-zinc-300">No Saga Yet</h3>
              <p className="text-xs text-zinc-500 mt-1.5 max-w-xs">
                Select a character in Player Data to see your vitals, skills and saga stats here.
              </p>
              <button
                onClick={() => navigate("/player")}
                className="mt-4 text-xs px-4 py-2 rounded-lg bg-brand-500/15 border border-brand-500/30 text-brand-400 hover:bg-brand-500/25 transition-colors"
              >
                Open Player Data
              </button>
            </div>
          )}
        </div>

        {/* Side column: biomes + meta */}
        <div className="space-y-4">
          {/* Biomes discovered */}
          <div className="glass rounded-2xl p-5 border-zinc-800/50">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-brand-400" />
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Biomes Walked
              </span>
            </div>
            <div className="text-4xl font-norse font-bold text-brand-300 leading-none">
              {character?.known_biomes.length ?? 0}
              <span className="text-sm text-zinc-500 ml-1">/ 9</span>
            </div>
            {character && character.known_biomes.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {character.known_biomes.slice(0, 9).map((b) => (
                  <span
                    key={b}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-400 border border-zinc-700/40"
                  >
                    {b}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Trophies */}
          <div className="glass rounded-2xl p-5 border-zinc-800/50">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="w-4 h-4 text-amber-400" />
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Trophies Claimed
              </span>
            </div>
            <div className="text-4xl font-norse font-bold text-amber-300 leading-none">
              {character?.trophies.length ?? 0}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              {character?.crafts ?? 0} crafts forged
            </div>
          </div>

          {/* Mod updates */}
          {availableUpdates > 0 && (
            <button
              onClick={() => navigate("/mods")}
              className="w-full glass rounded-2xl p-5 border-brand-500/30 bg-brand-500/5 hover:bg-brand-500/10 transition-colors text-left group"
            >
              <div className="flex items-center gap-2 mb-2">
                <Flame className="w-4 h-4 text-brand-400 group-hover:scale-110 transition-transform" />
                <span className="text-[11px] font-semibold text-brand-400 uppercase tracking-wider">
                  Updates Ready
                </span>
              </div>
              <div className="text-3xl font-norse font-bold text-brand-300 leading-none">
                {availableUpdates}
              </div>
              <div className="text-[10px] text-zinc-400 mt-1 group-hover:text-zinc-300">
                Click to install →
              </div>
            </button>
          )}
        </div>
      </div>

      {/* ─── QUICK ACTIONS ─── */}
      <div>
        <h2 className="font-norse font-bold text-xl text-zinc-200 tracking-wide mb-3">
          Forge &amp; Prepare
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ActionTile
            to="/mods"
            icon={Package}
            title="Mods"
            subtitle="Manage installed"
            color="text-brand-400"
            glowColor="brand"
            badge={availableUpdates > 0 ? `${availableUpdates}` : undefined}
          />
          <ActionTile
            to="/browse"
            icon={Globe}
            title="Browse"
            subtitle="Thunderstore"
            color="text-cyan-400"
            glowColor="cyan"
          />
          <ActionTile
            to="/config"
            icon={Settings2}
            title="Config"
            subtitle="Tune mods"
            color="text-purple-400"
            glowColor="purple"
          />
          <ActionTile
            to="/trainer"
            icon={Gamepad2}
            title="Trainer"
            subtitle="Godlike toggles"
            color="text-red-400"
            glowColor="red"
          />
        </div>
      </div>

      {/* ─── RECENT SESSION UPDATES ─── */}
      {sessionUpdatedMods.length > 0 && (
        <div className="glass rounded-2xl p-5 border-emerald-500/20 bg-emerald-500/[0.03]">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
              Just Updated
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sessionUpdatedMods.map((m) => (
              <span
                key={m}
                className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ─── No-profile call to action ─── */}
      {!activeProfileId && (
        <div className="glass rounded-2xl p-6 border-brand-500/30 bg-brand-500/5">
          <h3 className="font-norse font-bold text-2xl text-brand-400 mb-1">
            Begin your Saga
          </h3>
          <p className="text-sm text-zinc-400 mb-4">
            Forge a profile to ready your mods for the Tenth World.
          </p>
          <button
            onClick={() => navigate("/profiles")}
            className="px-4 py-2 rounded-lg bg-brand-500 text-zinc-950 font-semibold text-sm hover:bg-brand-400 transition-colors"
          >
            Create Profile
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function HeroStat({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Package;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="text-center">
      <Icon className={`w-4 h-4 ${color} mx-auto mb-1 opacity-80`} />
      <div className={`font-norse font-bold text-3xl leading-none ${color}`}>{value}</div>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

function Vital({
  icon: Icon,
  label,
  value,
  max,
  color,
  textColor,
}: {
  icon: typeof Heart;
  label: string;
  value: number;
  max: number;
  color: string;
  textColor: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3 h-3 ${textColor}`} />
        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`text-lg font-norse font-bold leading-none mt-1.5 ${textColor}`}>
        {value}
        <span className="text-xs text-zinc-600 ml-1">/ {max}</span>
      </div>
    </div>
  );
}

function SagaStat({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Skull;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-zinc-800/30 rounded-lg p-2.5 border border-zinc-800/40">
      <Icon className={`w-3.5 h-3.5 ${color} mb-1.5`} />
      <div className={`font-norse font-bold text-2xl leading-none ${color}`}>{value}</div>
      <div className="text-[9px] text-zinc-500 uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

const GLOW_CLASSES: Record<string, string> = {
  brand: "hover:border-brand-500/40 hover:bg-brand-500/[0.06]",
  cyan: "hover:border-cyan-500/40 hover:bg-cyan-500/[0.06]",
  purple: "hover:border-purple-500/40 hover:bg-purple-500/[0.06]",
  red: "hover:border-red-500/40 hover:bg-red-500/[0.06]",
};

function ActionTile({
  to,
  icon: Icon,
  title,
  subtitle,
  color,
  glowColor,
  badge,
}: {
  to: string;
  icon: typeof Package;
  title: string;
  subtitle: string;
  color: string;
  glowColor: string;
  badge?: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className={`glass rounded-2xl p-5 text-left border-zinc-800/50 transition-all duration-200 group relative ${GLOW_CLASSES[glowColor]}`}
    >
      {badge && (
        <span className="absolute top-3 right-3 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-500 text-zinc-950">
          {badge}
        </span>
      )}
      <Icon className={`w-6 h-6 ${color} mb-3 group-hover:scale-110 transition-transform`} />
      <h3 className="font-norse font-bold text-xl text-zinc-100 tracking-wide leading-none">
        {title}
      </h3>
      <p className="text-[11px] text-zinc-500 mt-1">{subtitle}</p>
    </button>
  );
}
