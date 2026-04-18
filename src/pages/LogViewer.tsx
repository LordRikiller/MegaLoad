import { useEffect, useState, useRef, useCallback } from "react";
import { useProfileStore } from "../stores/profileStore";
import { useIdentityStore } from "../stores/identityStore";
import {
  readLogTail,
  clearLog,
  getLogSize,
  saveLogFile,
  saveTextFile,
  getUpdateLog,
  getDiagnosticLogsPath,
  type LogLine,
  type UpdateLogEntry,
} from "../lib/tauri-api";
import { save } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  FileText,
  Trash2,
  RefreshCw,
  Search,
  ArrowDown,
  X,
  Download,
  Copy,
  History,
} from "lucide-react";
import { cn } from "../lib/utils";

type LogLevel = "all" | "error" | "warning" | "info" | "debug";
type LogTab = "bepinex" | "updates";

// Format: LogOutput_YYYY-MM-DD_HH-MM-SS_{player_id}.log
// Timestamp and player_id make each export uniquely identifiable per-user,
// so support can distinguish "latest log for player X" from "latest overall".
function buildLogFilename(playerId: string | undefined): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const idSegment = playerId ? `_${playerId}` : "";
  return `LogOutput_${stamp}${idSegment}.log`;
}

export function LogViewer() {
  const { activeProfile } = useProfileStore();
  const profile = activeProfile();
  const identity = useIdentityStore((s) => s.identity);
  const [activeTab, setActiveTab] = useState<LogTab>("bepinex");
  const [lines, setLines] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [logSize, setLogSize] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LogLevel>("all");
  const [refreshInterval, setRefreshInterval] = useState<number | null>(3000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [updateEntries, setUpdateEntries] = useState<UpdateLogEntry[]>([]);

  const fetchLog = useCallback(async () => {
    if (!profile?.bepinex_path) return;
    try {
      const [data, size] = await Promise.all([
        readLogTail(profile.bepinex_path, 131072),
        getLogSize(profile.bepinex_path),
      ]);
      setLines(data);
      setLogSize(size);
    } catch {
      // silently fail
    }
  }, [profile?.bepinex_path]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetchLog().finally(() => setLoading(false));
  }, [fetchLog]);

  // Load update log when tab switches
  useEffect(() => {
    if (activeTab === "updates") {
      getUpdateLog().then((entries) => setUpdateEntries(entries.reverse())).catch((e) => console.warn("[MegaLoad]", e));
    }
  }, [activeTab]);

  // Auto-refresh
  useEffect(() => {
    if (!refreshInterval) return;
    const timer = setInterval(fetchLog, refreshInterval);
    return () => clearInterval(timer);
  }, [fetchLog, refreshInterval]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleClear = async () => {
    if (profile?.bepinex_path) {
      await clearLog(profile.bepinex_path);
      setLines([]);
      setLogSize(0);
    }
  };

  const handleExport = async () => {
    const text = filteredLines.map((l) => l.text).join("\n");
    const filename = buildLogFilename(identity?.user_id);
    const dir = await getDiagnosticLogsPath().catch(() => null);
    const defaultPath = dir ? `${dir}${dir.includes("\\") ? "\\" : "/"}${filename}` : filename;
    const dest = await save({
      defaultPath,
      filters: [{ name: "Log Files", extensions: ["log", "txt"] }],
    });
    if (!dest) return;
    await saveTextFile(dest, text);
  };

  const handleCopy = async () => {
    const text = filteredLines.map((l) => l.text).join("\n");
    await navigator.clipboard.writeText(text);
  };

  const handleDownload = async () => {
    if (!profile?.bepinex_path) return;
    const filename = buildLogFilename(identity?.user_id);
    const dir = await getDiagnosticLogsPath().catch(() => null);
    const defaultPath = dir ? `${dir}${dir.includes("\\") ? "\\" : "/"}${filename}` : filename;
    const dest = await save({
      defaultPath,
      filters: [{ name: "Log Files", extensions: ["log", "txt"] }],
    });
    if (!dest) return;
    await saveLogFile(profile.bepinex_path, dest);
  };

  // Filter lines
  const filteredLines = lines.filter((line) => {
    if (levelFilter !== "all" && line.level !== levelFilter) return false;
    if (
      search &&
      !line.text.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });

  const levelCounts = {
    error: lines.filter((l) => l.level === "error").length,
    warning: lines.filter((l) => l.level === "warning").length,
    info: lines.filter((l) => l.level === "info").length,
    debug: lines.filter((l) => l.level === "debug").length,
  };

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <AlertCircle className="w-12 h-12 text-zinc-600 mb-4" />
        <h2 className="text-xl font-semibold text-zinc-300">
          No Active Profile
        </h2>
        <p className="text-zinc-500 mt-2">Select a profile to view logs</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-norse font-bold text-4xl text-zinc-100 tracking-wide">Log Viewer</h1>
          {/* Tabs */}
          <div className="flex items-center gap-1 mt-2">
            <button
              onClick={() => setActiveTab("bepinex")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                activeTab === "bepinex"
                  ? "bg-brand-500/15 text-brand-400"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <FileText className="w-3.5 h-3.5" />
              BepInEx Log
            </button>
            <button
              onClick={() => setActiveTab("updates")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                activeTab === "updates"
                  ? "bg-brand-500/15 text-brand-400"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <History className="w-3.5 h-3.5" />
              Update History
              {updateEntries.length > 0 && (
                <span className="text-[10px] tabular-nums text-zinc-500">{updateEntries.length}</span>
              )}
            </button>
          </div>
        </div>
        {activeTab === "bepinex" && (
          <div className="flex items-center gap-2">
            {/* Auto-refresh toggle */}
            <button
              onClick={() =>
                setRefreshInterval((prev) => (prev ? null : 3000))
              }
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                refreshInterval
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "glass border border-zinc-800 text-zinc-400"
              )}
            >
              <RefreshCw
                className={cn(
                  "w-3.5 h-3.5",
                  refreshInterval && "animate-spin"
                )}
                style={{
                  animationDuration: refreshInterval ? "3s" : undefined,
                }}
              />
              {refreshInterval ? "Live" : "Paused"}
            </button>

            <button
              onClick={fetchLog}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg glass border border-zinc-800 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>

            <button
              onClick={handleExport}
              disabled={filteredLines.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg glass border border-zinc-800 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-30"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>

            <button
              onClick={handleCopy}
              disabled={filteredLines.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg glass border border-zinc-800 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-30"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy
            </button>

            <button
              onClick={handleDownload}
              disabled={logSize === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg glass border border-zinc-800 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-30"
            >
              <FileText className="w-3.5 h-3.5" />
              Download Full Log
            </button>

            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg glass border border-zinc-800 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          </div>
        )}
      </div>

      {/* ─── Update History Tab ─── */}
      {activeTab === "updates" && (
        <div className="flex-1 glass rounded-xl border border-zinc-800/50 overflow-y-auto min-h-0">
          {updateEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <History className="w-8 h-8 text-zinc-700 mb-2" />
              <p className="text-zinc-500 text-sm">No updates recorded yet</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {updateEntries.map((entry, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                    entry.update_type === "app" ? "bg-brand-500/15" : "bg-blue-500/10"
                  )}>
                    {entry.update_type === "app" ? (
                      <Download className="w-4 h-4 text-brand-400" />
                    ) : (
                      <FileText className="w-4 h-4 text-blue-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-200">{entry.name}</p>
                    <p className="text-xs text-zinc-500">
                      {entry.from_version
                        ? `v${entry.from_version.replace(/^v/, "")} → v${entry.to_version.replace(/^v/, "")}`
                        : `Installed v${entry.to_version.replace(/^v/, "")}`}
                    </p>
                  </div>
                  <p className="text-[10px] text-zinc-600 flex-shrink-0">
                    {formatTimestamp(entry.timestamp)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── BepInEx Log Tab ─── */}
      {activeTab === "bepinex" && <>
      {/* Filter Bar */}
      <div className="flex items-center gap-3 mb-3">
        {/* Search */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Filter log lines..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-10 py-2 rounded-lg glass border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand-500/50 transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Level filters */}
        <div className="flex rounded-lg glass border border-zinc-800 overflow-hidden">
          {(
            [
              { key: "all", label: "All", count: lines.length },
              {
                key: "error",
                label: "Errors",
                count: levelCounts.error,
                color: "text-red-400",
              },
              {
                key: "warning",
                label: "Warn",
                count: levelCounts.warning,
                color: "text-yellow-400",
              },
              {
                key: "info",
                label: "Info",
                count: levelCounts.info,
                color: "text-blue-400",
              },
              {
                key: "debug",
                label: "Debug",
                count: levelCounts.debug,
                color: "text-zinc-500",
              },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              onClick={() => setLevelFilter(f.key)}
              className={cn(
                "px-3 py-2 text-xs font-medium transition-colors flex items-center gap-1.5",
                levelFilter === f.key
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {f.label}
              {f.count > 0 && (
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    "color" in f ? f.color : "text-zinc-500"
                  )}
                >
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Log Content */}
      <div
        ref={scrollRef}
        className="flex-1 glass rounded-xl border border-zinc-800/50 overflow-y-auto font-mono text-xs leading-5 min-h-0 select-text"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom =
            Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 20;
          setAutoScroll(atBottom);
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 rounded-full border-2 border-brand-400 border-t-transparent animate-spin" />
          </div>
        ) : filteredLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <FileText className="w-8 h-8 text-zinc-700 mb-2" />
            <p className="text-zinc-500 text-sm">
              {lines.length === 0 ? "No log data" : "No matching lines"}
            </p>
          </div>
        ) : (
          <div className="p-3">
            {filteredLines.map((line, i) => (
              <div
                key={i}
                className={cn(
                  "px-2 py-0.5 rounded hover:bg-zinc-800/30 transition-colors whitespace-pre-wrap break-all",
                  line.level === "error" && "text-red-400 bg-red-500/5",
                  line.level === "warning" && "text-yellow-400",
                  line.level === "info" && "text-zinc-300",
                  line.level === "debug" && "text-zinc-600"
                )}
              >
                {line.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {!autoScroll && (
        <button
          onClick={() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              setAutoScroll(true);
            }
          }}
          className="fixed bottom-6 right-6 p-3 rounded-full bg-brand-500 text-zinc-950 shadow-lg hover:bg-brand-400 transition-colors"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
      </>}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const day = String(d.getDate()).padStart(2, "0");
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  const yr = d.getFullYear();
  const hr = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${mon}/${yr} ${hr}:${min}`;
}
