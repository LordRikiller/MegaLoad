import { useEffect, useState, useRef, useCallback } from "react";
import { useProfileStore } from "../stores/profileStore";
import {
  readLogTail,
  clearLog,
  getLogSize,
  saveLogFile,
  saveTextFile,
  type LogLine,
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
} from "lucide-react";
import { cn } from "../lib/utils";

type LogLevel = "all" | "error" | "warning" | "info" | "debug";

export function LogViewer() {
  const { activeProfile } = useProfileStore();
  const profile = activeProfile();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [logSize, setLogSize] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LogLevel>("all");
  const [refreshInterval, setRefreshInterval] = useState<number | null>(3000);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    const dest = await save({
      defaultPath: `LogOutput_${new Date().toISOString().slice(0, 10)}.log`,
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
    const dest = await save({
      defaultPath: `LogOutput_${new Date().toISOString().slice(0, 10)}.log`,
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

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
          <h1 className="text-3xl font-bold text-zinc-100">Log Viewer</h1>
          <p className="text-zinc-500 mt-1">
            BepInEx LogOutput.log &middot; {formatSize(logSize)} &middot;{" "}
            {lines.length} lines
          </p>
        </div>
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
      </div>

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
    </div>
  );
}
