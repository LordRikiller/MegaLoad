import { useEffect, useRef } from "react";
import { useAppUpdateStore } from "../stores/appUpdateStore";
import { useUpdateStore } from "../stores/updateStore";
import { useProfileStore } from "../stores/profileStore";
import { useToastStore } from "../stores/toastStore";

/**
 * Starts live polling for both app and mod updates.
 * Fires toast notifications when new updates are detected.
 * Mount once in AppShell.
 */
export function useLiveUpdateChecks() {
  const { startLiveCheck: startAppPoll, stopLiveCheck: stopAppPoll } =
    useAppUpdateStore();
  const { startLiveCheck: startModPoll, stopLiveCheck: stopModPoll } =
    useUpdateStore();
  const profile = useProfileStore((s) => s.activeProfile());
  const addToast = useToastStore((s) => s.addToast);

  // Track what we've already notified about to avoid spam
  const notifiedAppVersion = useRef<string | null>(null);
  const prevModUpdateCount = useRef<number | null>(null);

  // --- App update polling ---
  useEffect(() => {
    startAppPoll();
    return () => stopAppPoll();
  }, [startAppPoll, stopAppPoll]);

  // --- Mod update polling (needs active profile) ---
  useEffect(() => {
    if (profile?.bepinex_path) {
      startModPoll(profile.bepinex_path);
    }
    return () => stopModPoll();
  }, [profile?.bepinex_path, startModPoll, stopModPoll]);

  // --- Toast: new app update detected ---
  const appStatus = useAppUpdateStore((s) => s.status);
  const newVersion = useAppUpdateStore((s) => s.newVersion);

  useEffect(() => {
    if (
      appStatus === "update-available" &&
      newVersion &&
      newVersion !== notifiedAppVersion.current
    ) {
      notifiedAppVersion.current = newVersion;
      addToast({
        type: "update",
        title: `MegaLoad v${newVersion} available`,
        message: "A new version is ready to install.",
        action: {
          label: "Update Now",
          onClick: () =>
            useAppUpdateStore.getState().installAndRelaunch(),
        },
        duration: 0, // sticky until dismissed or clicked
      });
    }
  }, [appStatus, newVersion, addToast]);

  // --- Toast: new mod updates detected ---
  const modResult = useUpdateStore((s) => s.updateResult);
  const startupCheckDone = useUpdateStore((s) => s.startupCheckDone);

  useEffect(() => {
    if (!modResult || !startupCheckDone) return;

    const available = modResult.mods.filter(
      (m) => m.status === "update-available"
    ).length;

    // Only toast if there are new updates we haven't notified about
    if (available > 0 && available !== prevModUpdateCount.current) {
      const names = modResult.mods
        .filter((m) => m.status === "update-available")
        .map((m) => m.latest_version ? `${m.name} v${m.latest_version}` : m.name)
        .join(", ");

      addToast({
        type: "update",
        title: `${available} mod update${available > 1 ? "s" : ""} available`,
        message: names,
        duration: 15000, // auto-dismiss after 15s
      });
    }

    prevModUpdateCount.current = available;
  }, [modResult, startupCheckDone, addToast]);
}
