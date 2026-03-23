import { useState, useEffect, useCallback } from "react";
import { User, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useIdentityStore } from "../../stores/identityStore";

export function IdentityGate({ children }: { children: React.ReactNode }) {
  const { identity, loading, error, loadIdentity, saveIdentity, checkAvailable, loadAdminStatus, loadBanStatus } =
    useIdentityStore();
  const [nameInput, setNameInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [initialized, setInitialized] = useState(false);

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

  const handleSubmit = async () => {
    if (!nameInput.trim() || loading || available === false) return;
    try {
      await saveIdentity(nameInput.trim());
    } catch {
      // Error is set in the store
    }
  };

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
            <User className="w-8 h-8 text-brand-400" />
          </div>
          <h2 className="text-xl font-bold text-zinc-100">Welcome to MegaLoad</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Choose a display name to get started. This is your permanent identity
            across MegaChat, MegaBugs, and all MegaLoad features.
          </p>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <input
              className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand-500/50 pr-10"
              placeholder="Your display name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={50}
              onKeyDown={(e) =>
                e.key === "Enter" && nameInput.trim() && available !== false && handleSubmit()
              }
              autoFocus
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {checking && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />}
              {!checking && available === true && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
              {!checking && available === false && (
                <AlertCircle className="w-4 h-4 text-red-400" />
              )}
            </div>
          </div>
          {available === false && (
            <p className="text-xs text-red-400">That name is already taken. Try another.</p>
          )}
          <p className="text-xs text-zinc-500">
            Letters, numbers, spaces, hyphens and underscores only. Max 50 characters.
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
          disabled={!nameInput.trim() || loading || available === false || checking}
          onClick={handleSubmit}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Setting up...
            </span>
          ) : (
            "Get Started"
          )}
        </button>
      </div>
    </div>
  );
}
