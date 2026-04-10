import { useState, useEffect, useCallback } from "react";
import { User, Loader2, AlertCircle, CheckCircle2, Link } from "lucide-react";
import { useIdentityStore } from "../../stores/identityStore";

export function IdentityGate({ children }: { children: React.ReactNode }) {
  const { identity, loading, error, loadIdentity, saveIdentity, linkAccount, checkAvailable, loadAdminStatus, loadBanStatus } =
    useIdentityStore();
  const [nameInput, setNameInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [mode, setMode] = useState<"new" | "link">("new");

  useEffect(() => {
    const init = async () => {
      await loadIdentity();
      await loadAdminStatus();
      setInitialized(true);
    };
    init();
  }, [loadIdentity, loadAdminStatus]);

  // Load ban status once identity is known
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

  // Reset state when switching modes
  useEffect(() => {
    setNameInput("");
    setAvailable(null);
  }, [mode]);

  const handleSubmit = async () => {
    if (!nameInput.trim() || loading) return;

    if (mode === "link") {
      // Link mode: name must already exist (available === false means taken = exists)
      if (available !== false) return;
      try {
        await linkAccount(nameInput.trim());
      } catch {
        // Error is set in the store
      }
    } else {
      // New mode: name must be available
      if (available === false) return;
      try {
        await saveIdentity(nameInput.trim());
      } catch {
        // Error is set in the store
      }
    }
  };

  // In link mode: name found = good (available === false means it exists on server)
  const linkNameFound = mode === "link" && available === false;
  const linkNameNotFound = mode === "link" && available === true;

  // Can submit?
  const canSubmit = mode === "new"
    ? nameInput.trim() && !loading && available !== false && !checking
    : nameInput.trim() && !loading && linkNameFound && !checking;

  // Still loading initial state
  if (!initialized) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  // Identity already set — render children
  if (identity) {
    return <>{children}</>;
  }

  // Identity setup modal
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <div className="glass rounded-2xl p-8 max-w-md w-full mx-4 space-y-6 animate-in">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-brand-500/15 flex items-center justify-center mx-auto">
            {mode === "new" ? (
              <User className="w-8 h-8 text-brand-400" />
            ) : (
              <Link className="w-8 h-8 text-cyan-400" />
            )}
          </div>
          <h2 className="text-xl font-bold text-zinc-100">
            {mode === "new" ? "Welcome to MegaLoad" : "Link Existing Account"}
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            {mode === "new"
              ? "Choose a display name to get started. This is your identity across MegaChat, MegaBugs, and all MegaLoad features."
              : "Enter your existing display name to link this device to your account."}
          </p>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <input
              className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand-500/50 pr-10"
              placeholder={mode === "new" ? "Your display name" : "Your existing display name"}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={50}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && handleSubmit()}
              autoFocus
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {checking && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />}
              {!checking && mode === "new" && available === true && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
              {!checking && mode === "new" && available === false && (
                <AlertCircle className="w-4 h-4 text-red-400" />
              )}
              {!checking && linkNameFound && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
              {!checking && linkNameNotFound && (
                <AlertCircle className="w-4 h-4 text-red-400" />
              )}
            </div>
          </div>
          {mode === "new" && available === false && (
            <p className="text-xs text-red-400">That name is already taken. Try another.</p>
          )}
          {linkNameFound && (
            <p className="text-xs text-emerald-400">Account found! Click below to link this device.</p>
          )}
          {linkNameNotFound && (
            <p className="text-xs text-red-400">No account found with that name.</p>
          )}
          <p className="text-xs text-zinc-500">
            {mode === "new"
              ? "Letters, numbers, spaces, hyphens and underscores only. Max 50 characters."
              : "Enter the exact display name you used on your other device."}
          </p>
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
              {mode === "new" ? "Setting up..." : "Linking..."}
            </span>
          ) : mode === "new" ? (
            "Get Started"
          ) : (
            "Link Device"
          )}
        </button>

        <div className="text-center">
          <button
            onClick={() => setMode(mode === "new" ? "link" : "new")}
            className="text-xs text-zinc-500 hover:text-brand-400 transition-colors"
          >
            {mode === "new"
              ? "I already have an account on another device"
              : "Create a new account instead"}
          </button>
        </div>
      </div>
    </div>
  );
}
