import { useState, useEffect, useCallback } from "react";
import { User, Loader2, AlertCircle, CheckCircle2, Copy, Check, Download } from "lucide-react";
import { useIdentityStore } from "../../stores/identityStore";
import { useAppUpdateStore } from "../../stores/appUpdateStore";
import { validateIdentity } from "../../lib/tauri-api";

function UpdateBanner() {
  const { status, newVersion, downloadProgress, installAndRelaunch } = useAppUpdateStore();

  if (status === "idle" || status === "checking") return null;

  return (
    <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-top-2 duration-300">
      {status === "update-available" && (
        <button
          onClick={installAndRelaunch}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-white text-sm font-bold shadow-2xl shadow-brand-500/30 transition-all"
        >
          <Download className="w-4 h-4" />
          Update MegaLoad to v{newVersion}
        </button>
      )}
      {status === "downloading" && (
        <div className="flex items-center gap-3 px-5 py-2.5 rounded-xl bg-zinc-900 border border-brand-500/30 text-brand-400 text-sm font-medium shadow-2xl">
          <Loader2 className="w-4 h-4 animate-spin" />
          Downloading update... {downloadProgress}%
        </div>
      )}
      {status === "ready" && (
        <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-sm font-medium shadow-2xl">
          <CheckCircle2 className="w-4 h-4" />
          Restarting...
        </div>
      )}
      {status === "error" && (
        <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs shadow-2xl">
          <AlertCircle className="w-3.5 h-3.5" />
          Update failed — try again later
        </div>
      )}
    </div>
  );
}

export function IdentityGate({ children }: { children: React.ReactNode }) {
  const { identity, loading, error, linkCode, loadIdentity, saveIdentity, linkAccount, checkAvailable, clearLinkCode, loadAdminStatus, loadBanStatus } =
    useIdentityStore();
  const [nameInput, setNameInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const init = async () => {
      await loadIdentity();
      // Check for legacy accounts (pre-v1.1.0 without link code) — clears identity if legacy
      const valid = await validateIdentity().catch(() => true);
      if (!valid) {
        // Identity was cleared — reload to show registration screen
        await loadIdentity();
      } else {
        await loadAdminStatus();
      }
      setInitialized(true);
    };
    init();
  }, [loadIdentity, loadAdminStatus]);

  useEffect(() => {
    if (identity) {
      loadBanStatus();
    }
  }, [identity, loadBanStatus]);

  // Debounced availability check
  const checkName = useCallback(
    async (name: string) => {
      if (name.trim().length < 2) {
        setAvailable(null);
        return;
      }
      setChecking(true);
      try {
        const ok = await checkAvailable(name.trim());
        setAvailable(ok);
      } catch {
        setAvailable(null);
      } finally {
        setChecking(false);
      }
    },
    [checkAvailable]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (nameInput.trim().length >= 2) {
        checkName(nameInput);
      } else {
        setAvailable(null);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [nameInput, checkName]);

  // Name is taken = existing account, show link code input
  const isExisting = available === false;
  const isNew = available === true;

  const handleSubmit = async () => {
    if (!nameInput.trim() || loading) return;

    if (isExisting) {
      // Link flow — requires code
      if (!codeInput.trim()) return;
      try {
        await linkAccount(nameInput.trim(), codeInput.trim());
      } catch {
        // Error is set in the store
      }
    } else if (isNew) {
      // New account flow
      try {
        await saveIdentity(nameInput.trim());
      } catch {
        // Error is set in the store
      }
    }
  };

  const canSubmit = isNew
    ? nameInput.trim() && !loading && !checking
    : isExisting
      ? nameInput.trim() && !loading && !checking && codeInput.trim().length >= 12
      : false;

  const handleCopyCode = async () => {
    if (!linkCode) return;
    await navigator.clipboard.writeText(linkCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Still loading initial state
  if (!initialized) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  // Identity set AND no link code to show — render children
  if (identity && !linkCode) {
    return <>{children}</>;
  }

  // Link code reveal screen — shown after new account creation
  if (identity && linkCode) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
        <UpdateBanner />
        <div className="glass rounded-2xl p-8 max-w-md w-full mx-4 space-y-6 animate-in">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-zinc-100">Account Created!</h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Save this <strong className="text-zinc-200">link code</strong> — you'll need it to connect MegaLoad on other devices to this account.
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <div className="px-6 py-4 rounded-xl bg-zinc-900/80 border border-zinc-700/50">
              <span className="text-2xl font-mono font-bold tracking-widest text-brand-400">
                {linkCode}
              </span>
            </div>
            <button
              onClick={handleCopyCode}
              className="p-3 rounded-xl bg-zinc-800/50 hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Copy to clipboard"
            >
              {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
            <p className="text-xs text-amber-400">
              This code is shown only once. You can regenerate it later from Settings, but only from a device already linked to this account.
            </p>
          </div>

          <button
            className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500 text-white text-sm font-bold transition-all duration-200 shadow-lg"
            onClick={() => clearLinkCode()}
          >
            I've saved it — Continue
          </button>
        </div>
      </div>
    );
  }

  // Unified identity setup / link modal
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <UpdateBanner />
      <div className="glass rounded-2xl p-8 max-w-md w-full mx-4 space-y-6 animate-in">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-brand-500/15 flex items-center justify-center mx-auto">
            <User className="w-8 h-8 text-brand-400" />
          </div>
          <h2 className="text-xl font-bold text-zinc-100">Welcome to MegaLoad</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Enter a display name to create a new account, or enter your existing name to link this device.
          </p>
        </div>

        <div className="space-y-3">
          {/* Display name input */}
          <div className="space-y-1">
            <div className="relative">
              <input
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand-500/50 pr-10"
                placeholder="Your display name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={50}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) handleSubmit();
                }}
                autoFocus
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {checking && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />}
                {!checking && isNew && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                )}
                {!checking && isExisting && !codeInput && (
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                )}
                {!checking && isExisting && codeInput && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                )}
              </div>
            </div>

            {isNew && (
              <p className="text-xs text-emerald-400">Name available — ready to create your account.</p>
            )}
            {isExisting && (
              <p className="text-xs text-cyan-400">Account found — enter your link code below to connect this device.</p>
            )}
            {!isNew && !isExisting && available === null && nameInput.trim().length >= 2 && !checking && (
              <p className="text-xs text-zinc-500">Letters, numbers, spaces, hyphens and underscores only.</p>
            )}
          </div>

          {/* Link code input — shown automatically when name is taken */}
          {isExisting && (
            <div className="space-y-1 animate-in fade-in slide-in-from-top-2 duration-300">
              <input
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 font-mono tracking-wider uppercase"
                placeholder="XXXX-XXXX-XXXX"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                maxLength={14}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) handleSubmit();
                }}
                autoFocus
              />
              <p className="text-xs text-zinc-500">
                The link code was shown when this account was created, or can be regenerated in Settings on the original device.
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        <button
          className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500 text-white text-sm font-bold transition-all duration-200 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {isExisting ? "Linking..." : "Setting up..."}
            </span>
          ) : isExisting ? (
            "Link Device"
          ) : (
            "Get Started"
          )}
        </button>
      </div>
    </div>
  );
}
