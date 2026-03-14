import { useEffect } from "react";
import { useProfileStore } from "../stores/profileStore";
import { useModStore } from "../stores/modStore";
import { Package, Users, Rocket, Settings2, Globe, Gamepad2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function Dashboard() {
  const { activeProfileId, fetchProfiles, activeProfile } =
    useProfileStore();
  const { mods, fetchMods } = useModStore();
  const navigate = useNavigate();
  const profile = activeProfile();

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  useEffect(() => {
    if (profile?.bepinex_path) {
      fetchMods(profile.bepinex_path);
    }
  }, [profile?.bepinex_path, fetchMods]);

  const enabledMods = mods.filter((m) => m.enabled).length;
  const disabledMods = mods.filter((m) => !m.enabled).length;

  const stats = [
    {
      label: "Active Profile",
      value: profile?.name ?? "None",
      icon: Users,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      label: "Total Mods",
      value: mods.length.toString(),
      icon: Package,
      color: "text-brand-400",
      bg: "bg-brand-500/10",
    },
    {
      label: "Enabled",
      value: enabledMods.toString(),
      icon: Rocket,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Disabled",
      value: disabledMods.toString(),
      icon: Settings2,
      color: "text-zinc-400",
      bg: "bg-zinc-500/10",
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-zinc-100">Dashboard</h1>
        <p className="text-zinc-500 mt-1">
          Welcome to MegaLoad — your Valheim mod manager
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 stagger-children">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="glass rounded-xl p-5 hover:border-zinc-700/50 transition-all duration-300"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
              </div>
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                {stat.label}
              </span>
            </div>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-200 mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-3 gap-4 stagger-children">
          <button
            onClick={() => navigate("/mods")}
            className="glass rounded-xl p-5 text-left glass-hover group"
          >
            <Package className="w-6 h-6 text-brand-400 mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-semibold text-zinc-200">Manage Mods</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Enable, disable, or install mods
            </p>
          </button>
          <button
            onClick={() => navigate("/browse")}
            className="glass rounded-xl p-5 text-left glass-hover group"
          >
            <Globe className="w-6 h-6 text-cyan-400 mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-semibold text-zinc-200">Browse Mods</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Find and install mods from Thunderstore
            </p>
          </button>
          <button
            onClick={() => navigate("/trainer")}
            className="glass rounded-xl p-5 text-left glass-hover group"
          >
            <Gamepad2 className="w-6 h-6 text-red-400 mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-semibold text-zinc-200">Trainer</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Toggle god mode, unlimited stamina, and more
            </p>
          </button>
          <button
            onClick={() => navigate("/config")}
            className="glass rounded-xl p-5 text-left glass-hover group"
          >
            <Settings2 className="w-6 h-6 text-purple-400 mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-semibold text-zinc-200">Config Editor</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Edit mod configurations with smart controls
            </p>
          </button>
          <button
            onClick={() => navigate("/profiles")}
            className="glass rounded-xl p-5 text-left glass-hover group"
          >
            <Users className="w-6 h-6 text-blue-400 mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-semibold text-zinc-200">Profiles</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Switch between mod configurations
            </p>
          </button>
        </div>
      </div>

      {/* No Profile Warning */}
      {!activeProfileId && (
        <div className="glass rounded-xl p-6 border-brand-500/30 bg-brand-500/5">
          <h3 className="font-semibold text-brand-400 mb-2">
            No Active Profile
          </h3>
          <p className="text-sm text-zinc-400 mb-4">
            Create a profile to get started managing your mods.
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
