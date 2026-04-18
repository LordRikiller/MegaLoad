import { useEffect, useState } from "react";
import {
  detectValheimPath,
  detectR2modmanProfiles,
  importR2modmanProfile,
  ensureDoorstop,
  downloadBepinex,
  readAppLog,
  clearAppLog,
  getAppLogPath,
  openDataDir,
  chatSaveApiKey,
  chatClearApiKey,
  chatGetApiKeyStatus,
  regenerateLinkCode,
  getDiagnosticLogsPath,
  setDiagnosticLogsPath,
  getMegaDebugStatus,
  toggleAllMegaDebug,
  type MegaDebugEntry,
} from "../lib/tauri-api";
import { useBugStore } from "../stores/bugStore";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { useProfileStore } from "../stores/profileStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useAppUpdateStore } from "../stores/appUpdateStore";
import { useChatStore } from "../stores/chatStore";
import { useSyncStore } from "../stores/syncStore";
import { useIdentityStore } from "../stores/identityStore";
import {
  FolderOpen,
  RefreshCw,
  Check,
  Download,
  Loader2,
  Info,
  Shield,
  AlertTriangle,
  ScrollText,
  Trash2,
  ToggleLeft,
  ToggleRight,
  MessageCircle,
  Key,
  ExternalLink,
  Eye,
  EyeOff,
  Cloud,
  CloudOff,
  Upload,
  User,
  LogOut,
  Bug,
} from "lucide-react";
import { cn } from "../lib/utils";

export function Settings() {
  const { fetchProfiles } = useProfileStore();
  const activeProfile = useProfileStore((s) => s.activeProfile());
  const { loggingEnabled, megabugsEnabled, loaded: settingsLoaded, fetchSettings, setLoggingEnabled, setMegabugsEnabled } = useSettingsStore();
  const { debugEnabled, debugLoaded, fetchDebug, setDebugEnabled } = useChatStore();
  const { currentVersion } = useAppUpdateStore();
  const { identity, clearIdentity } = useIdentityStore();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const {
    enabled: syncEnabled,
    autoSync,
    syncing,
    syncProgress,
    lastPush,
    lastPull,
    error: syncError,
    loaded: syncLoaded,
    fetchSyncStatus,
    setEnabled: setSyncEnabled,
    setAutoSync: setSyncAutoSync,
    pushAllProfiles,
    pullAllProfiles,
  } = useSyncStore();
  const [valheimPath, setValheimPath] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [r2Profiles, setR2Profiles] = useState<[string, string][]>([]);
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [doorstopOk, setDoorstopOk] = useState<boolean | null>(null);
  const [installingDoorstop, setInstallingDoorstop] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [logPreview, setLogPreview] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyHasKey, setApiKeyHasKey] = useState(false);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const bugsRole = useBugStore((s) => s.role);
  const isOwner = bugsRole === "owner";
  const [diagLogsPath, setDiagLogsPath] = useState<string>("");
  const [megaDebug, setMegaDebug] = useState<MegaDebugEntry[]>([]);
  const [megaDebugBusy, setMegaDebugBusy] = useState(false);
  const [megaDebugLoaded, setMegaDebugLoaded] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchDebug();
    fetchSyncStatus();
    chatGetApiKeyStatus().then(setApiKeyHasKey).catch((e) => console.warn("[MegaLoad]", e));
    getDiagnosticLogsPath().then((p) => setDiagLogsPath(p ?? "")).catch((e) => console.warn("[MegaLoad]", e));
    detectValheimPath()
      .then((p) => {
        setValheimPath(p);
        ensureDoorstop(p).then(setDoorstopOk).catch(() => setDoorstopOk(false));
      })
      .catch((e) => console.warn("[MegaLoad]", e));
    // R2Modman detection — completely optional, silent failure
    detectR2modmanProfiles()
      .then(setR2Profiles)
      .catch(() => setR2Profiles([]));
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    if (!activeProfile?.bepinex_path) {
      setMegaDebug([]);
      setMegaDebugLoaded(true);
      return;
    }
    getMegaDebugStatus(activeProfile.bepinex_path)
      .then((entries) => {
        setMegaDebug(entries);
        setMegaDebugLoaded(true);
      })
      .catch((e) => {
        console.warn("[MegaLoad] mega debug status:", e);
        setMegaDebugLoaded(true);
      });
  }, [activeProfile?.bepinex_path]);

  const megaDebugAllOn =
    megaDebug.length > 0 && megaDebug.every((e) => e.debug_mode === true);
  const megaDebugEnabledCount = megaDebug.filter((e) => e.debug_mode === true).length;

  const handleToggleAllMegaDebug = async () => {
    if (!activeProfile?.bepinex_path || megaDebugBusy) return;
    const nextEnabled = !megaDebugAllOn;
    setMegaDebugBusy(true);
    try {
      const result = await toggleAllMegaDebug(activeProfile.bepinex_path, nextEnabled);
      const refreshed = await getMegaDebugStatus(activeProfile.bepinex_path);
      setMegaDebug(refreshed);
      const label = nextEnabled ? "ON" : "OFF";
      if (result.skipped.length > 0) {
        setToast(
          `Debug ${label} on ${result.updated.length} Mega mod${result.updated.length === 1 ? "" : "s"} (${result.skipped.length} skipped — likely not launched yet)`
        );
      } else {
        setToast(`Debug ${label} on ${result.updated.length} Mega mod${result.updated.length === 1 ? "" : "s"}`);
      }
    } catch (e) {
      setToast(`Failed to toggle Mega debug: ${e}`);
    } finally {
      setMegaDebugBusy(false);
    }
  };

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const path = await detectValheimPath();
      setValheimPath(path);
      // Check doorstop after detecting
      const ok = await ensureDoorstop(path);
      setDoorstopOk(ok);
    } catch {
      // Leave as is
    } finally {
      setDetecting(false);
    }
  };

  const handleSetupDoorstop = async () => {
    if (!valheimPath) return;
    setInstallingDoorstop(true);
    try {
      // First try to install from existing local sources
      let ok = await ensureDoorstop(valheimPath);
      if (!ok) {
        // No local doorstop source — download BepInEx from GitHub
        // (this installs doorstop to game dir as a side effect)
        setToast("Downloading BepInEx from GitHub...");
        // Use a temp profile path just for the doorstop extraction
        const tempPath = valheimPath + "\\BepInEx";
        await downloadBepinex(valheimPath, tempPath);
        ok = true;
      }
      setDoorstopOk(ok);
      if (ok) {
        setToast("Doorstop installed successfully!");
      }
    } catch (e) {
      setToast(`Failed: ${e}`);
    } finally {
      setInstallingDoorstop(false);
    }
  };

  const handleImport = async (name: string, path: string) => {
    setImporting(name);
    try {
      await importR2modmanProfile(name, path);
      setImported((prev) => new Set([...prev, name]));
      await fetchProfiles();
      setToast(`Imported "${name}" successfully!`);
    } catch (e) {
      setToast(`Failed to import: ${e}`);
    } finally {
      setImporting(null);
    }
  };

  const handleToggleLogging = async () => {
    await setLoggingEnabled(!loggingEnabled);
    setToast(loggingEnabled ? "Logging disabled" : "Logging enabled");
  };

  const handlePickDiagLogsPath = async () => {
    const picked = await openFolderDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    await setDiagnosticLogsPath(picked);
    setDiagLogsPath(picked);
    setToast("Diagnostic logs folder updated");
  };

  const handleClearDiagLogsPath = async () => {
    await setDiagnosticLogsPath(null);
    setDiagLogsPath("");
    setToast("Diagnostic logs folder reset");
  };

  const handleToggleChatDebug = async () => {
    await setDebugEnabled(!debugEnabled);
    setToast(debugEnabled ? "MegaChat debug disabled" : "MegaChat debug enabled");
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) return;
    setApiKeySaving(true);
    try {
      await chatSaveApiKey(apiKey.trim());
      setApiKeyHasKey(true);
      setApiKey("");
      setApiKeyVisible(false);
      setToast("API key saved!");
    } catch (e) {
      setToast(`Failed: ${e}`);
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleClearApiKey = async () => {
    try {
      await chatClearApiKey();
      setApiKeyHasKey(false);
      setApiKey("");
      setToast("API key removed");
    } catch (e) {
      setToast(`Failed: ${e}`);
    }
  };

  const handleDownloadLog = async () => {
    setDownloading(true);
    try {
      const content = await readAppLog(10000);
      if (!content) {
        setToast("Log file is empty");
        return;
      }
      const logPath = await getAppLogPath();
      const fileName = logPath.split("\\").pop() || "megaload.log";
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setToast("Log downloaded");
    } catch (e) {
      setToast(`Failed: ${e}`);
    } finally {
      setDownloading(false);
    }
  };

  const handlePreviewLog = async () => {
    try {
      const content = await readAppLog(50);
      setLogPreview(content || "(empty)");
    } catch {
      setLogPreview("(failed to read log)");
    }
  };

  const handleClearLog = async () => {
    await clearAppLog();
    setLogPreview(null);
    setToast("Log cleared");
  };

  return (
    <div className="space-y-8 max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Toast */}
      {toast && (
        <div className="fixed top-14 right-6 z-50 px-4 py-2.5 rounded-lg bg-brand-500/90 text-zinc-950 text-sm font-medium shadow-xl animate-in slide-in-from-top-2 duration-300">
          {toast}
        </div>
      )}

      <div>
        <h1 className="font-norse font-bold text-4xl text-zinc-100 tracking-wide">Settings</h1>
        <p className="text-zinc-500 mt-1">Configure MegaLoad</p>
      </div>

      {/* Account */}
      {identity && (
        <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-4">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-zinc-300">Account</h2>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-200">{identity.display_name}</p>
              <p className="text-[10px] text-zinc-600 font-mono">{identity.user_id}</p>
            </div>
            {!showLogoutConfirm ? (
              <button
                onClick={() => setShowLogoutConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/50 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Switch Account
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Are you sure?</span>
                <button
                  onClick={async () => {
                    await clearIdentity();
                    setShowLogoutConfirm(false);
                    setToast("Signed out — restart to set up a new identity");
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Confirm
                </button>
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {/* Link code regenerate */}
          <div className="flex items-center gap-3">
            {generatedCode ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-bold tracking-wider text-brand-400 bg-zinc-900/80 border border-zinc-700/50 rounded-lg px-4 py-2">
                  {generatedCode}
                </span>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(generatedCode);
                    setCodeCopied(true);
                    setTimeout(() => setCodeCopied(false), 2000);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {codeCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Key className="w-3.5 h-3.5" />}
                  {codeCopied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <button
                onClick={async () => {
                  setRegenerating(true);
                  try {
                    const code = await regenerateLinkCode();
                    setGeneratedCode(code);
                    setToast("New link code generated — save it to link other devices");
                  } catch (e) {
                    setToast(`Failed: ${e}`);
                  } finally {
                    setRegenerating(false);
                  }
                }}
                disabled={regenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors disabled:opacity-50"
              >
                {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                Generate Link Code
              </button>
            )}
          </div>

          <p className="text-xs text-zinc-600">
            Your identity is shared across MegaChat, MegaBugs, and Cloud Sync. Use a link code to connect this account on other devices.
          </p>
        </div>
      )}

      {/* Cloud Sync */}
      <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-zinc-300">Cloud Sync</h2>
          </div>
          {syncLoaded && (
            <button
              onClick={async () => {
                await setSyncEnabled(!syncEnabled);
                setToast(syncEnabled ? "Cloud sync disabled" : "Cloud sync enabled — pushing profiles...");
              }}
              className="shrink-0"
            >
              {syncEnabled ? (
                <ToggleRight className="w-8 h-8 text-cyan-400" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-zinc-600" />
              )}
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          {syncEnabled
            ? "Profiles, mods, and configs are synced across your devices. Changes push automatically."
            : "Enable to sync your profiles, installed mods, and configs across multiple PCs."}
        </p>

        {syncEnabled && (
          <div className="space-y-4">
            {/* Auto-sync toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-300 font-medium">Auto-sync on changes</p>
                <p className="text-[10px] text-zinc-600">Automatically push when mods or configs change</p>
              </div>
              <button
                onClick={async () => {
                  await setSyncAutoSync(!autoSync);
                  setToast(autoSync ? "Auto-sync disabled" : "Auto-sync enabled");
                }}
                className="shrink-0"
              >
                {autoSync ? (
                  <ToggleRight className="w-6 h-6 text-cyan-400" />
                ) : (
                  <ToggleLeft className="w-6 h-6 text-zinc-600" />
                )}
              </button>
            </div>

            {/* Manual push/pull buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  try {
                    await pushAllProfiles();
                    setToast("Profiles pushed to cloud");
                  } catch (e) {
                    setToast(`Push failed: ${e}`);
                  }
                }}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
              >
                {syncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                Push All
              </button>
              <button
                onClick={async () => {
                  try {
                    await pullAllProfiles();
                    setToast("Profiles pulled from cloud");
                  } catch (e) {
                    setToast(`Pull failed: ${e}`);
                  }
                }}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
              >
                {syncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Pull All
              </button>
            </div>

            {/* Sync progress */}
            {syncing && syncProgress && (
              <div className="flex items-center gap-2 text-xs text-cyan-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {syncProgress}
              </div>
            )}

            {/* Last sync info */}
            <SyncTimestamp lastPush={lastPush} lastPull={lastPull} />

            {/* Sync error */}
            {syncError && (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <CloudOff className="w-3.5 h-3.5" />
                {syncError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Valheim Path */}
      <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-semibold text-zinc-300">
            Valheim Installation
          </h2>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={valheimPath}
              onChange={(e) => setValheimPath(e.target.value)}
              placeholder="C:\Program Files (x86)\Steam\steamapps\common\Valheim"
              className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand-500/50 transition-all font-mono"
            />
          </div>
          <button
            onClick={handleDetect}
            disabled={detecting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg glass border border-zinc-800 text-sm font-medium text-zinc-300 hover:bg-zinc-800/50 transition-colors"
          >
            <RefreshCw
              className={cn("w-4 h-4", detecting && "animate-spin")}
            />
            Auto-detect
          </button>
        </div>
        {valheimPath && (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <Check className="w-3.5 h-3.5" />
            Valheim found
          </div>
        )}
      </div>

      {/* Doorstop / BepInEx Loader Status */}
      {valheimPath && (
        <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-zinc-300">
              BepInEx Loader (Doorstop)
            </h2>
          </div>
          {doorstopOk === true ? (
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              Doorstop is installed — BepInEx can bootstrap when launching Valheim
            </div>
          ) : doorstopOk === false ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                Doorstop not found — BepInEx cannot load mods without it
              </div>
              <button
                onClick={handleSetupDoorstop}
                disabled={installingDoorstop}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/15 text-purple-400 text-xs font-medium hover:bg-purple-500/25 transition-colors disabled:opacity-50"
              >
                {installingDoorstop ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Shield className="w-3.5 h-3.5" />
                )}
                Install Doorstop
              </button>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Checking...</p>
          )}
        </div>
      )}

      {/* R2Modman Import — only shown when R2Modman is detected */}
      {r2Profiles.length > 0 && (
        <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-4">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-zinc-300">
              Import from R2Modman
            </h2>
          </div>
          <p className="text-xs text-zinc-500">
            We detected {r2Profiles.length} R2Modman profile
            {r2Profiles.length > 1 ? "s" : ""} on this machine. You can import them to MegaLoad — this is optional.
          </p>
          <div className="space-y-2">
            {r2Profiles.map(([name, path]) => {
              const isImported = imported.has(name);
              const isImporting = importing === name;

              return (
                <div
                  key={path}
                  className="flex items-center justify-between px-4 py-3 rounded-lg bg-zinc-900/50 border border-zinc-800/30"
                >
                  <div className="flex items-center gap-3">
                    {isImported ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <FolderOpen className="w-4 h-4 text-zinc-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-zinc-300">
                        {name}
                      </p>
                      <p className="text-[10px] text-zinc-600 font-mono truncate max-w-sm">
                        {path}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleImport(name, path)}
                    disabled={isImported || isImporting}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      isImported
                        ? "bg-emerald-500/10 text-emerald-400 cursor-default"
                        : isImporting
                          ? "bg-zinc-800 text-zinc-500 cursor-wait"
                          : "bg-brand-500/10 text-brand-400 hover:bg-brand-500/20"
                    )}
                  >
                    {isImported ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Imported
                      </>
                    ) : isImporting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        Import
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* App Logging */}
      <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-zinc-300">App Logging</h2>
          </div>
          {settingsLoaded && (
            <button onClick={handleToggleLogging} className="shrink-0">
              {loggingEnabled ? (
                <ToggleRight className="w-8 h-8 text-brand-400" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-zinc-600" />
              )}
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          {loggingEnabled
            ? "MegaLoad logs all operations (mods, updates, launches, config changes) to a local file."
            : "Enable to record all MegaLoad operations for debugging and troubleshooting."}
        </p>
        {loggingEnabled && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadLog}
                disabled={downloading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Download Log
              </button>
              <button
                onClick={handlePreviewLog}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
              >
                <ScrollText className="w-3.5 h-3.5" />
                Preview
              </button>
              <button
                onClick={handleClearLog}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/50 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>
            {logPreview !== null && (
              <div className="max-h-48 overflow-y-auto rounded-lg bg-zinc-950 border border-zinc-800/50 p-3">
                <pre className="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">
                  {logPreview}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mega mods debug — bulk toggle DebugMode across every Mega* cfg */}
      <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-zinc-300">Mega Mods Debug</h2>
          </div>
          {megaDebugLoaded && megaDebug.length > 0 && (
            <button
              onClick={handleToggleAllMegaDebug}
              disabled={megaDebugBusy}
              className="shrink-0 disabled:opacity-40"
              title={megaDebugAllOn ? "Turn DebugMode OFF on every Mega mod" : "Turn DebugMode ON on every Mega mod"}
            >
              {megaDebugBusy ? (
                <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
              ) : megaDebugAllOn ? (
                <ToggleRight className="w-8 h-8 text-brand-400" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-zinc-600" />
              )}
            </button>
          )}
        </div>
        {!megaDebugLoaded ? (
          <p className="text-xs text-zinc-500">Scanning BepInEx configs…</p>
        ) : !activeProfile ? (
          <p className="text-xs text-zinc-500">Select a profile to manage Mega mods debug.</p>
        ) : megaDebug.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No Mega mod configs found in this profile yet. Launch Valheim once so each mod writes its default config, then come back.
          </p>
        ) : (
          <>
            <p className="text-xs text-zinc-500">
              Flips <span className="font-mono text-zinc-400">DebugMode</span> under
              <span className="font-mono text-zinc-400"> [99. Debug]</span> in every Mega mod config for the active profile.
              Handy before asking a user for a log — one click instead of twelve.
            </p>
            <div className="text-xs text-zinc-400">
              {megaDebugEnabledCount} of {megaDebug.length} Mega mod config{megaDebug.length === 1 ? "" : "s"} currently have DebugMode
              <span className={megaDebugEnabledCount > 0 ? "text-brand-400 font-medium" : "text-zinc-500"}> ON</span>.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {megaDebug.map((e) => (
                <span
                  key={e.file_name}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono border",
                    e.debug_mode === true
                      ? "bg-brand-500/10 text-brand-400 border-brand-500/30"
                      : e.debug_mode === false
                      ? "bg-zinc-800/40 text-zinc-500 border-zinc-700/50"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  )}
                  title={e.file_name + (e.debug_mode === null ? " — [99. Debug]/DebugMode not found" : "")}
                >
                  {e.mod_name}
                  {e.debug_mode === null && "?"}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Diagnostic logs folder — owner only */}
      {isOwner && (
        <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-zinc-300">Diagnostic Logs Folder</h2>
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-400 font-medium">OWNER</span>
          </div>
          <p className="text-xs text-zinc-500">
            When downloading a user's log from a MegaBugs ticket, save it here as
            <span className="font-mono text-zinc-400"> MegaBugs_{`{ticket_id}_{author}`}.log</span>.
            Empty = MegaLoad AppData/Logs fallback.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 rounded-lg bg-zinc-950 border border-zinc-800/50 px-3 py-2 text-xs font-mono text-zinc-300 truncate">
              {diagLogsPath || <span className="text-zinc-600">(not set)</span>}
            </div>
            <button
              onClick={handlePickDiagLogsPath}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Pick Folder
            </button>
            {diagLogsPath && (
              <button
                onClick={handleClearDiagLogsPath}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800/50 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* MegaChat API Key */}
      <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-4">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-semibold text-zinc-300">MegaChat API Key</h2>
        </div>
        <p className="text-xs text-zinc-500">
          MegaChat uses your own Anthropic API key. Usage is billed to your Anthropic account.
        </p>
        {apiKeyHasKey ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              API key configured
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleClearApiKey}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/50 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove Key
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type={apiKeyVisible ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveApiKey(); }}
                  placeholder="sk-ant-..."
                  className="w-full px-4 py-2.5 pr-10 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand-500/50 transition-all font-mono"
                  autoComplete="off"
                />
                <button
                  onClick={() => setApiKeyVisible(!apiKeyVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {apiKeyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={handleSaveApiKey}
                disabled={!apiKey.trim() || apiKeySaving}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-medium transition-colors",
                  apiKey.trim() && !apiKeySaving
                    ? "bg-brand-500/15 text-brand-400 hover:bg-brand-500/25"
                    : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                )}
              >
                {apiKeySaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Save
              </button>
            </div>
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Get an API key from console.anthropic.com
            </a>
          </div>
        )}
        <p className="text-xs text-zinc-600">
          Your key is stored locally and never sent anywhere except Anthropic's API.
        </p>
      </div>

      {/* MegaChat Debug */}
      <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-zinc-300">MegaChat Debug</h2>
          </div>
          {debugLoaded && (
            <button onClick={handleToggleChatDebug} className="shrink-0">
              {debugEnabled ? (
                <ToggleRight className="w-8 h-8 text-brand-400" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-zinc-600" />
              )}
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          {debugEnabled
            ? "Shows token usage per message, daily totals, and logs API requests to the app log."
            : "Enable to see token usage and API diagnostics in MegaChat."}
        </p>
      </div>

      {/* MegaBugs */}
      <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-400" />
            <h2 className="text-sm font-semibold text-zinc-300">MegaBugs</h2>
          </div>
          <button
            onClick={() => {
              setMegabugsEnabled(!megabugsEnabled);
              setToast(megabugsEnabled ? "MegaBugs hidden from sidebar" : "MegaBugs visible in sidebar");
            }}
            className="shrink-0"
          >
            {megabugsEnabled ? (
              <ToggleRight className="w-8 h-8 text-brand-400" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-zinc-600" />
            )}
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          {megabugsEnabled
            ? "MegaBugs is visible in the sidebar — submit bug reports and feature requests."
            : "MegaBugs is hidden from the sidebar. Enable to submit bug reports and feature requests."}
        </p>
      </div>

      {/* Data Location */}
      <div className="glass rounded-xl p-5 border border-zinc-800/50 space-y-3">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-300">Data Location</h2>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-zinc-500 font-mono">
            %APPDATA%\MegaLoad\
          </p>
          <button
            onClick={() => openDataDir()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
            title="Open in Explorer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Open
          </button>
        </div>
        <p className="text-xs text-zinc-600">
          Profiles, settings, and configuration data are stored here.
        </p>
      </div>

      {/* About */}
      <div className="glass rounded-xl p-5 border border-zinc-800/50">
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">About</h2>
        <div className="space-y-2 text-sm text-zinc-500">
          <p>
            <span className="text-zinc-300 font-semibold">MegaLoad</span>{" "}
            <span className="text-brand-400">v{currentVersion}</span>
          </p>
          <p>A modern Valheim mod manager built with Tauri + React</p>
          <p className="text-xs text-zinc-600">
            Rust backend &middot; React frontend &middot; Tailwind CSS
          </p>
        </div>
      </div>
    </div>
  );
}

function SyncTimestamp({ lastPush, lastPull }: { lastPush: string | null; lastPull: string | null }) {
  if (!lastPush && !lastPull) return null;
  const fmt = (iso: string) => {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const mon = String(d.getMonth() + 1).padStart(2, "0");
    const yr = d.getFullYear();
    const hr = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${mon}/${yr} ${hr}:${min}`;
  };
  const pushMs = lastPush ? new Date(lastPush).getTime() : 0;
  const pullMs = lastPull ? new Date(lastPull).getTime() : 0;
  let label: string;
  if (pushMs && pullMs && Math.abs(pushMs - pullMs) < 5000) {
    label = `Synced ${fmt(pushMs > pullMs ? lastPush! : lastPull!)}`;
  } else if (pushMs >= pullMs && lastPush) {
    label = `Pushed ${fmt(lastPush)}`;
  } else if (lastPull) {
    label = `Pulled ${fmt(lastPull)}`;
  } else {
    return null;
  }
  return <p className="text-[10px] text-zinc-500">{label}</p>;
}
