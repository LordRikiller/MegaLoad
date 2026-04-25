import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Titlebar } from "./Titlebar";
import { Sidebar } from "./Sidebar";
import { IdentityGate } from "./IdentityGate";
import { ToastContainer } from "../ToastContainer";
import { ErrorBoundary } from "../ErrorBoundary";
import { useLiveUpdateChecks } from "../../hooks/useLiveUpdateChecks";
import { useAutoSync } from "../../hooks/useAutoSync";
import { useAutoPlayerSync } from "../../hooks/useAutoPlayerSync";
import { useMegaListStore } from "../../stores/megaListStore";

export function AppShell() {
  useLiveUpdateChecks();
  useAutoSync();
  useAutoPlayerSync();
  const location = useLocation();

  // Hydrate MegaList blob from localStorage on app start.
  useEffect(() => {
    useMegaListStore.getState().init();
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <Titlebar />
      <IdentityGate>
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="flex-1 overflow-y-auto p-6">
            {/* key={pathname} resets the boundary on route change so a crash
                on one page doesn't poison the next one. */}
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </IdentityGate>
      <ToastContainer />
    </div>
  );
}
